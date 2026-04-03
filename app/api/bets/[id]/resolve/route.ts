import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { supportsPeerResolution } from "@/lib/bet-resolution"
import { getAuthenticatedUserId } from "@/lib/server-auth"

type ResolveAction = "claim_win" | "claim_lose" | "confirm" | "reject"

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
  const authenticatedUserId = await getAuthenticatedUserId(request)
  if (!authenticatedUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const paramsResolved = await context.params
  const betId = paramsResolved.id

  try {
    const body = await request.json()
    const { user_id, action, reason } = body as { user_id?: string; action?: ResolveAction; reason?: string }

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 })
    }

    if (user_id && user_id !== authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized user scope" }, { status: 403 })
    }

    const effectiveUserId = authenticatedUserId

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

      const pendingStatus = winnerId === bet.creator_id
        ? "pending_resolution_creator"
        : "pending_resolution_acceptor"

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

      return NextResponse.json({ success: true, bet: updatedBet })
    }

    if (bet.status !== "pending_resolution_creator" && bet.status !== "pending_resolution_acceptor") {
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

      return NextResponse.json({ success: true, bet: disputedBet })
    }

    const winnerUserId = bet.winner_id || (bet.status === "pending_resolution_creator" ? bet.creator_id : bet.acceptor_id)

    const totalPrize = Number(bet.amount) * Number(bet.multiplier) + Number(bet.amount)

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

    return NextResponse.json({ success: true, bet: resolvedBet })
  } catch (error: unknown) {
    console.error("Peer resolve bet error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
