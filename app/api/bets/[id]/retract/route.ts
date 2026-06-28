import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { payoutToMode, tokenTypeForMode } from "@/lib/wallet-utils"
import { createNotifications } from "@/lib/notifications"
import { creditGroupWallet } from "@/lib/group-wallet-utils"

const GRACE_MS = 12 * 60 * 60 * 1000

function retractWindow(
  eventStartIso: string,
  eventStatus: string
): "grace" | "pre_game" | "in_game" {
  const eventStartMs = new Date(eventStartIso).getTime()
  const now = Date.now()
  if (eventStatus === "live" || eventStatus === "finished") return "in_game"
  if (now < eventStartMs - GRACE_MS) return "grace"
  return "pre_game"
}

function calcRefunds(
  bet: { amount: number; fee_amount: number; multiplier: number; bet_type: string },
  cancellerId: string,
  creatorId: string,
  timingWindow: "grace" | "pre_game" | "in_game",
  betStatus: string,
  isGroupBet = false
): { creatorRefund: number; acceptorRefund: number } {
  const creatorStake = Number(bet.amount)
  const creatorFee = Number(bet.fee_amount)
  const isAsymmetric = bet.bet_type === "exact_score"
  const acceptorStake = isAsymmetric
    ? creatorStake * Math.max(1, Number(bet.multiplier))
    : creatorStake
  const acceptorFee = isGroupBet ? 0 : acceptorStake * 0.03

  if (betStatus === "open") {
    return {
      creatorRefund: timingWindow === "grace" ? creatorStake + creatorFee : creatorStake,
      acceptorRefund: 0,
    }
  }

  // Taken bet
  if (timingWindow === "grace") {
    return {
      creatorRefund: creatorStake + creatorFee,
      acceptorRefund: acceptorStake + acceptorFee,
    }
  }

  const penaltyRate = timingWindow === "in_game" ? 0.40 : 0.10
  const penalty = creatorStake * penaltyRate

  if (cancellerId === creatorId) {
    return {
      creatorRefund: creatorStake - penalty,
      acceptorRefund: acceptorStake + acceptorFee + penalty,
    }
  } else {
    return {
      creatorRefund: creatorStake + creatorFee + penalty,
      acceptorRefund: acceptorStake - penalty,
    }
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()
  const { id: betId } = await context.params

  const { data: bet, error: betError } = await supabase
    .from("bets")
    .select("*, event:events(*)")
    .eq("id", betId)
    .single()

  if (betError || !bet) {
    return NextResponse.json({ error: "Bet not found" }, { status: 404 })
  }

  if ((bet as any).house_bet) {
    return NextResponse.json({ error: "Las apuestas contra la casa no pueden retractarse" }, { status: 400 })
  }

  const isCreator = bet.creator_id === userId
  const isAcceptor = bet.acceptor_id === userId

  if (!isCreator && !isAcceptor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_banned, betting_blocked_until, role")
    .eq("id", userId)
    .single()

  if (profileError) {
    const missingColumn = profileError.message?.includes("betting_blocked_until")
    if (!missingColumn) {
      return NextResponse.json({ error: "Failed to validate user profile" }, { status: 500 })
    }
  }

  if (!profileError && profile?.is_banned) {
    return NextResponse.json({ error: "Usuario bloqueado" }, { status: 403 })
  }

  if (!profileError && profile?.betting_blocked_until) {
    const blockedUntil = new Date(profile.betting_blocked_until)
    if (blockedUntil > new Date()) {
      return NextResponse.json({
        error: `No puedes realizar esta acción hasta ${blockedUntil.toLocaleString("es-ES")}`,
      }, { status: 403 })
    }
  }

  if (!profileError && profile?.role === "backoffice_admin") {
    return NextResponse.json({ error: "Los usuarios de backoffice no pueden retractarse de apuestas" }, { status: 403 })
  }

  if (bet.status === "open" && !isCreator) {
    return NextResponse.json({ error: "Solo el creador puede cancelar una apuesta abierta" }, { status: 400 })
  }

  const allowedStatuses = ["open", "taken"]
  if (!allowedStatuses.includes(bet.status)) {
    return NextResponse.json(
      { error: "No puedes retractarte en este estado de la apuesta" },
      { status: 400 }
    )
  }

  const event = Array.isArray(bet.event) ? bet.event[0] : bet.event
  if (!event?.start_time) {
    return NextResponse.json({ error: "Evento no encontrado" }, { status: 400 })
  }

  const isGroupBet = Boolean((bet as any).group_id)
  const timingWindow = retractWindow(event.start_time, event.status)
  const refunds = calcRefunds(bet, userId, bet.creator_id, timingWindow, bet.status, isGroupBet)
  const betMode = bet.mode === "real" ? "real" : "fantasy"
  const action = isCreator ? "retract_creator" : "retract_acceptor"

  if (refunds.creatorRefund < 0 || refunds.acceptorRefund < 0) {
    console.error("NEGATIVE_REFUND", { betId, refunds })
    return NextResponse.json({ error: "Error calculando reembolsos" }, { status: 500 })
  }

  const { data: updatedRows, error: cancelError } = await supabase
    .from("bets")
    .update({ status: "cancelled" })
    .eq("id", betId)
    .in("status", allowedStatuses)
    .select("id")

  if (cancelError) {
    return NextResponse.json({ error: cancelError.message }, { status: 500 })
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: "La apuesta ya fue modificada por otra acción" },
      { status: 409 }
    )
  }

  const groupId = (bet as any).group_id ?? null

  if (refunds.creatorRefund > 0) {
    try {
      if (groupId) {
        await creditGroupWallet(supabase, groupId, bet.creator_id, refunds.creatorRefund)
        await supabase.from("transactions").insert({
          user_id: bet.creator_id,
          token_type: "group_fantasy",
          amount: refunds.creatorRefund,
          operation: "bet_retracted_refund",
          reference_id: betId,
        })
      } else {
        await payoutToMode(supabase, bet.creator_id, refunds.creatorRefund, betMode)
        await supabase.from("transactions").insert({
          user_id: bet.creator_id,
          token_type: tokenTypeForMode(betMode),
          amount: refunds.creatorRefund,
          operation: "bet_retracted_refund",
          reference_id: betId,
        })
      }
    } catch (err) {
      console.error("REFUND_FAILED creator", { betId, userId: bet.creator_id, amount: refunds.creatorRefund, err })
      await supabase.from("bets").update({ status: bet.status }).eq("id", betId)
      return NextResponse.json({ error: "Error procesando reembolso del creador" }, { status: 500 })
    }
  }

  if (bet.status === "taken" && bet.acceptor_id && refunds.acceptorRefund > 0) {
    try {
      if (groupId) {
        await creditGroupWallet(supabase, groupId, bet.acceptor_id, refunds.acceptorRefund)
        await supabase.from("transactions").insert({
          user_id: bet.acceptor_id,
          token_type: "group_fantasy",
          amount: refunds.acceptorRefund,
          operation: "bet_retracted_refund",
          reference_id: betId,
        })
      } else {
        await payoutToMode(supabase, bet.acceptor_id, refunds.acceptorRefund, betMode)
        await supabase.from("transactions").insert({
          user_id: bet.acceptor_id,
          token_type: tokenTypeForMode(betMode),
          amount: refunds.acceptorRefund,
          operation: "bet_retracted_refund",
          reference_id: betId,
        })
      }
    } catch (err) {
      console.error("REFUND_FAILED acceptor", { betId, userId: bet.acceptor_id, amount: refunds.acceptorRefund, err })
      await supabase.from("bets").update({ status: bet.status }).eq("id", betId)
      return NextResponse.json({ error: "Error procesando reembolso del aceptante" }, { status: 500 })
    }
  }

  const penalty = timingWindow !== "grace" && bet.status === "taken"
    ? Number(bet.amount) * (timingWindow === "in_game" ? 0.40 : 0.10)
    : 0

  await supabase.from("arbitration_decisions").insert({
    bet_id: betId,
    action,
    previous_status: bet.status,
    new_status: "cancelled",
    decided_winner_id: null,
    reason: timingWindow === "grace"
      ? "Retracción dentro del período de gracia — sin penalidad"
      : `Retracción ${timingWindow === "in_game" ? "con partido en curso" : "pre-partido"} — penalidad ${timingWindow === "in_game" ? "40%" : "10%"}`,
    details: { window: timingWindow, penalty, creatorRefund: refunds.creatorRefund, acceptorRefund: refunds.acceptorRefund },
    decided_by: userId,
    source: "system",
  })

  const notifications = []
  const cancellerLabel = isCreator ? "El creador" : "El aceptante"
  const penaltyText = penalty > 0 ? ` (penalidad de ${penalty.toFixed(2)})` : ""

  notifications.push({
    userId: bet.creator_id,
    type: "bet_cancelled" as const,
    title: "Apuesta cancelada",
    body: `${cancellerLabel} se retractó de la apuesta sobre ${event.home_team} vs ${event.away_team}${penaltyText}. Reembolso: ${refunds.creatorRefund.toFixed(2)}.`,
    betId,
    mode: bet.mode ?? "fantasy",
  })

  if (bet.status === "taken" && bet.acceptor_id) {
    notifications.push({
      userId: bet.acceptor_id,
      type: "bet_cancelled" as const,
      title: "Apuesta cancelada",
      body: `${cancellerLabel} se retractó de la apuesta sobre ${event.home_team} vs ${event.away_team}${penaltyText}. Reembolso: ${refunds.acceptorRefund.toFixed(2)}.`,
      betId,
      mode: bet.mode ?? "fantasy",
    })
  }

  await createNotifications(notifications, supabase)

  return NextResponse.json({
    success: true,
    window: timingWindow,
    penalty,
    creatorRefund: refunds.creatorRefund,
    acceptorRefund: refunds.acceptorRefund,
  })
}
