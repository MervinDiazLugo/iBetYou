import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { supportsPeerResolution } from "@/lib/bet-resolution"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { createNotifications } from "@/lib/notifications"

type ResolveAction = "claim_win" | "claim_lose" | "confirm" | "reject"
const LEGACY_PENDING_CREATOR = "pending_resolution_creator"
const LEGACY_PENDING_ACCEPTOR = "pending_resolution_acceptor"

function isPendingResolutionStatus(status: string) {
  return status === "pending_resolution" || status === LEGACY_PENDING_CREATOR || status === LEGACY_PENDING_ACCEPTOR
}

async function logDecision(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  payload: {
    bet_id: string
    action: string
    previous_status?: string | null
    new_status?: string | null
    decided_winner_id?: string | null
    reason?: string | null
    details?: Record<string, unknown>
    decided_by?: string | null
  }
) {
  try {
    await supabase.from("arbitration_decisions").insert({
      bet_id: payload.bet_id,
      action: payload.action,
      previous_status: payload.previous_status ?? null,
      new_status: payload.new_status ?? null,
      decided_winner_id: payload.decided_winner_id ?? null,
      reason: payload.reason ?? null,
      details: payload.details ?? null,
      decided_by: payload.decided_by ?? null,
      source: "system",
    })
  } catch (error) {
    console.error("Failed to log peer decision:", error)
  }
}

function getClaimantId(bet: { creator_claimed?: boolean | null; acceptor_claimed?: boolean | null; creator_id: string; acceptor_id?: string | null }) {
  if (bet.creator_claimed && !bet.acceptor_claimed) return bet.creator_id
  if (bet.acceptor_claimed && !bet.creator_claimed) return bet.acceptor_id || null
  return null
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = createAdminSupabaseClient()
  const paramsResolved = await context.params
  const betId = paramsResolved.id

  try {
    const body = await request.json()
    const { user_id, action, reason } = body as { user_id?: string; action?: ResolveAction; reason?: string }

    const authenticatedUserId = await getAuthenticatedUserId(request)
    const host = request.headers.get("host") || ""
    const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1")
    const isDevLocalFallback = process.env.NODE_ENV !== "production" && isLocalhost

    const effectiveUserId = authenticatedUserId
      || (isDevLocalFallback && typeof user_id === "string" ? user_id : null)

    if (!effectiveUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 })
    }

    if (authenticatedUserId && user_id && user_id !== authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized user scope" }, { status: 403 })
    }

    const allowedActions: ResolveAction[] = ["claim_win", "claim_lose", "confirm", "reject"]
    if (!allowedActions.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    const { data: bet, error: betError } = await supabase
      .from("bets")
      .select("id, creator_id, acceptor_id, bet_type, status, amount, multiplier, winner_id, creator_claimed, acceptor_claimed, event:events(start_time)")
      .eq("id", betId)
      .single()

    if (betError || !bet) {
      return NextResponse.json({ error: "Bet not found" }, { status: 404 })
    }

    if (!supportsPeerResolution(bet.bet_type)) {
      return NextResponse.json({ error: "Este tipo de apuesta no usa resolucion entre participantes" }, { status: 400 })
    }

    if (!bet.acceptor_id) {
      return NextResponse.json({ error: "La apuesta aun no tiene aceptante" }, { status: 400 })
    }

    const isCreator = effectiveUserId === bet.creator_id
    const isAcceptor = effectiveUserId === bet.acceptor_id

    if (!isCreator && !isAcceptor) {
      return NextResponse.json({ error: "Solo participantes pueden resolver esta apuesta" }, { status: 403 })
    }

    const previousStatus = bet.status

    if (action === "claim_win" || action === "claim_lose") {
      if (bet.status !== "taken") {
        return NextResponse.json({ error: "Solo puedes reportar resultado en apuestas en curso" }, { status: 400 })
      }

      const eventRow = Array.isArray(bet.event) ? bet.event[0] : bet.event
      const eventStart = eventRow?.start_time ? new Date(eventRow.start_time) : null
      if (!eventStart || Number.isNaN(eventStart.getTime())) {
        return NextResponse.json({ error: "No se pudo validar la hora de inicio del evento" }, { status: 400 })
      }

      const unlockAt = new Date(eventStart.getTime() + 2 * 60 * 60 * 1000)
      if (new Date() < unlockAt) {
        return NextResponse.json({
          error: `Aún no puedes reportar resultado. Se habilita desde ${unlockAt.toLocaleString("es-ES")}`,
          available_at: unlockAt.toISOString(),
        }, { status: 400 })
      }

      const winnerId = action === "claim_win"
        ? effectiveUserId
        : (isCreator ? bet.acceptor_id : bet.creator_id)

      const pendingStatus = "pending_resolution"

      const updateData = {
        status: pendingStatus,
        winner_id: winnerId,
        creator_claimed: isCreator,
        acceptor_claimed: isAcceptor,
      }

      const { data: updatedBet, error: updateError } = await supabase
        .from("bets")
        .update(updateData)
        .eq("id", betId)
        .select("*")
        .single()

      if (updateError || !updatedBet) {
        return NextResponse.json({ error: updateError?.message || "No se pudo registrar el reporte" }, { status: 500 })
      }

      await logDecision(supabase, {
        bet_id: betId,
        action: "participant_claim",
        previous_status: previousStatus,
        new_status: pendingStatus,
        decided_winner_id: winnerId,
        reason: reason || (action === "claim_win" ? "Participante reporta que gano" : "Participante reporta que perdio"),
        details: { claimed_by: effectiveUserId, claim_action: action, bet_type: bet.bet_type },
        decided_by: effectiveUserId,
      })

      // Notify the other participant that a result was reported
      const otherId = isCreator ? bet.acceptor_id : bet.creator_id
      if (otherId) {
        await createNotifications([{
          userId: otherId,
          type: "result_reported",
          title: "Tu rival reportó el resultado",
          body: action === "claim_win"
            ? "Tu rival dice que ganó. Confirmá o disputá el resultado."
            : "Tu rival dice que perdió. Confirmá o disputá el resultado.",
          betId,
        }])
      }

      return NextResponse.json({ success: true, bet: updatedBet })
    }

    if (!isPendingResolutionStatus(bet.status)) {
      return NextResponse.json({ error: "Esta apuesta no esta pendiente de confirmacion" }, { status: 400 })
    }

    const claimantId = getClaimantId(bet)
    if (claimantId && claimantId === effectiveUserId) {
      return NextResponse.json({ error: "El usuario que reporto no puede confirmar su propio resultado" }, { status: 400 })
    }

    if (action === "reject") {
      const rejectUpdate = {
        status: "disputed",
      }

      const { data: disputedBet, error: disputeError } = await supabase
        .from("bets")
        .update(rejectUpdate)
        .eq("id", betId)
        .select("*")
        .single()

      if (disputeError || !disputedBet) {
        return NextResponse.json({ error: disputeError?.message || "No se pudo escalar a arbitraje" }, { status: 500 })
      }

      await logDecision(supabase, {
        bet_id: betId,
        action: "participant_reject_to_dispute",
        previous_status: previousStatus,
        new_status: "disputed",
        decided_winner_id: bet.winner_id,
        reason: reason || "Participante no acepta el resultado reportado",
        details: { rejected_by: effectiveUserId, bet_type: bet.bet_type },
        decided_by: effectiveUserId,
      })

      // Notify both parties that the bet is now disputed
      const disputeNotifs = [
        { userId: bet.creator_id, type: "bet_disputed" as const, title: "Apuesta en disputa", body: "El resultado fue rechazado. Un árbitro revisará la apuesta.", betId },
        ...(bet.acceptor_id ? [{ userId: bet.acceptor_id, type: "bet_disputed" as const, title: "Apuesta en disputa", body: "El resultado fue rechazado. Un árbitro revisará la apuesta.", betId }] : []),
      ]
      await createNotifications(disputeNotifs)

      return NextResponse.json({ success: true, bet: disputedBet })
    }

    const inferredWinnerId = getClaimantId(bet)
      || (bet.status === LEGACY_PENDING_CREATOR ? bet.creator_id : null)
      || (bet.status === LEGACY_PENDING_ACCEPTOR ? bet.acceptor_id : null)

    const winnerUserId = bet.winner_id || inferredWinnerId

    if (!winnerUserId) {
      return NextResponse.json({ error: "No se pudo determinar el ganador para confirmar" }, { status: 400 })
    }

    const totalPrize = Number(bet.amount) * Number(bet.multiplier) + Number(bet.amount)

    // Update bet first — if this fails, no money moves
    const confirmUpdate = {
      status: "resolved",
      winner_id: winnerUserId,
      resolved_at: new Date().toISOString(),
      creator_claimed: isCreator ? true : bet.creator_claimed,
      acceptor_claimed: isAcceptor ? true : bet.acceptor_claimed,
    }

    const { data: resolvedBet, error: resolveError } = await supabase
      .from("bets")
      .update(confirmUpdate)
      .eq("id", betId)
      .select("*")
      .single()

    if (resolveError || !resolvedBet) {
      return NextResponse.json({ error: resolveError?.message || "No se pudo confirmar resultado" }, { status: 500 })
    }

    // Bet confirmed resolved — now pay winner
    const { data: winnerWallet } = await supabase
      .from("wallets")
      .select("balance_fantasy")
      .eq("user_id", winnerUserId)
      .single()

    if (!winnerWallet) {
      return NextResponse.json({ error: "No se encontro billetera del ganador" }, { status: 404 })
    }

    await supabase
      .from("wallets")
      .update({ balance_fantasy: Number(winnerWallet.balance_fantasy) + totalPrize })
      .eq("user_id", winnerUserId)

    await supabase.from("transactions").insert({
      user_id: winnerUserId,
      token_type: "fantasy",
      amount: totalPrize,
      operation: "bet_won",
      reference_id: betId,
    })

    await logDecision(supabase, {
      bet_id: betId,
      action: "participant_confirm",
      previous_status: previousStatus,
      new_status: "resolved",
      decided_winner_id: winnerUserId,
      reason: reason || "Resultado confirmado por el rival",
      details: { confirmed_by: effectiveUserId, totalPrize, bet_type: bet.bet_type },
      decided_by: effectiveUserId,
    })

    // Notify winner and loser
    const loserId = winnerUserId === bet.creator_id ? bet.acceptor_id : bet.creator_id
    const resolveNotifs = [
      { userId: winnerUserId, type: "bet_resolved_win" as const, title: "¡Ganaste la apuesta!", body: `Ganaste $${totalPrize.toFixed(2)} Fantasy Tokens.`, betId },
      ...(loserId ? [{ userId: loserId, type: "bet_resolved_loss" as const, title: "Apuesta resuelta", body: "Perdiste esta apuesta. ¡Suerte la próxima!", betId }] : []),
    ]
    await createNotifications(resolveNotifs)

    return NextResponse.json({ success: true, bet: resolvedBet })
  } catch (error: unknown) {
    console.error("Peer resolve bet error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
