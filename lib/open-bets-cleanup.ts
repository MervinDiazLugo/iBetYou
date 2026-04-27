import { createAdminSupabaseClient } from "@/lib/supabase"
import { ACCEPT_WINDOW_MINUTES } from "@/lib/bet-constants"
import { createNotification } from "@/lib/notifications"

export async function cleanupExpiredOpenBets(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  decidedBy = "system"
) {
  const nowMs = Date.now()

  const { data: openBets, error: openBetsError } = await supabase
    .from("bets")
    .select("id, creator_id, amount, fee_amount, status, acceptor_id, event:events(start_time, status)")
    .eq("status", "open")
    .is("acceptor_id", null)
    .limit(1000)

  if (openBetsError || !openBets) {
    if (openBetsError) {
      console.error("Failed to fetch open bets for cleanup:", openBetsError)
    }
    return { scanned: 0, cancelled: 0, refunded: 0 }
  }

  let cancelled = 0
  let refunded = 0

  for (const bet of openBets as any[]) {
    const eventRow = Array.isArray(bet.event) ? bet.event[0] : bet.event
    if (!eventRow?.start_time) continue

    const startMs = new Date(eventRow.start_time).getTime()
    if (!Number.isFinite(startMs)) continue

    const acceptanceDeadlineMs = startMs + ACCEPT_WINDOW_MINUTES * 60 * 1000
    const eventStatus = (eventRow.status || "").toLowerCase()
    const shouldAutoCancel = nowMs > acceptanceDeadlineMs || eventStatus === "live" || eventStatus === "finished"
    if (!shouldAutoCancel) continue

    const { data: updatedBet, error: cancelError } = await supabase
      .from("bets")
      .update({ status: "cancelled" })
      .eq("id", bet.id)
      .eq("status", "open")
      .select("id, creator_id, amount, fee_amount")
      .single()

    if (cancelError || !updatedBet) {
      continue
    }

    cancelled += 1
    const creatorRefund = Number(updatedBet.amount || 0) + Number(updatedBet.fee_amount || 0)

    const { data: creatorWallet } = await supabase
      .from("wallets")
      .select("balance_fantasy")
      .eq("user_id", updatedBet.creator_id)
      .single()

    if (creatorWallet) {
      const { error: walletErr } = await supabase
        .from("wallets")
        .update({ balance_fantasy: Number(creatorWallet.balance_fantasy || 0) + creatorRefund })
        .eq("user_id", updatedBet.creator_id)

      if (!walletErr) {
        await supabase.from("transactions").insert({
          user_id: updatedBet.creator_id,
          token_type: "fantasy",
          amount: creatorRefund,
          operation: "bet_cancelled_refund",
          reference_id: updatedBet.id,
        })
        refunded += 1
      } else {
        console.error("Failed to refund wallet on bet expiry:", walletErr, { betId: updatedBet.id })
      }
    }

    await supabase.from("arbitration_decisions").insert({
      bet_id: updatedBet.id,
      action: "auto_cancel_open_expired",
      previous_status: "open",
      new_status: "cancelled",
      reason: "Tu apuesta se cerró automáticamente porque el evento ya inició. ¡Buen intento! Crea una nueva apuesta y sigue participando.",
      details: {
        event_status: eventStatus,
        acceptance_window_minutes: ACCEPT_WINDOW_MINUTES,
      },
      decided_by: decidedBy,
      source: "system",
    })

    await createNotification({
      userId: updatedBet.creator_id,
      type: "bet_cancelled",
      title: "Tu apuesta expiró",
      body: "Nadie tomó tu apuesta a tiempo. Te devolvimos tu saldo.",
      betId: updatedBet.id,
    }, supabase)
  }

  return {
    scanned: openBets.length,
    cancelled,
    refunded,
  }
}
