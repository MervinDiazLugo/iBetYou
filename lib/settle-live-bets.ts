import { settleLiveBet } from "@/lib/live-settlement"
import { isLiveP2PBetType } from "@/lib/live-bet-types"
import { calculateTotalPrize } from "@/lib/bet-resolution"
import { payoutToMode } from "@/lib/wallet-utils"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { createNotifications } from "@/lib/notifications"

type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * Settles all 'taken' P2P-live bets for one event.
 * Payment ordering invariant: the bet status is updated FIRST; money only moves after the
 * status transition succeeds (guarded by `.eq("status","taken")` so a concurrent settle can't
 * double-pay).
 *
 * @param cur current score { home, away }
 * @param finished whether the event has finished (enables "no more scoring" / void-at-finish)
 */
export async function settleLiveBetsForEvent(
  supabase: Admin,
  eventId: number,
  cur: { home: number; away: number },
  finished: boolean
): Promise<number> {
  const { data: bets } = await supabase
    .from("bets")
    .select("id, creator_id, acceptor_id, bet_type, creator_selection, selection, amount, multiplier, mode, status")
    .eq("event_id", eventId)
    .eq("status", "taken")
  if (!bets?.length) return 0

  let settled = 0
  for (const bet of bets) {
    if (!isLiveP2PBetType(bet.bet_type)) continue

    let baseline = { home: 0, away: 0 }
    try {
      const parsed = typeof bet.selection === "string" ? JSON.parse(bet.selection) : bet.selection
      if (parsed?.live_baseline) {
        baseline = {
          home: Number(parsed.live_baseline.home) || 0,
          away: Number(parsed.live_baseline.away) || 0,
        }
      }
    } catch {
      // malformed selection → keep zero baseline (conservative)
    }

    const res = settleLiveBet(bet.bet_type, bet.creator_selection, { cur, baseline, finished })
    if (res.status === "pending") continue

    if (res.status === "void") {
      const { data: upd } = await supabase
        .from("bets").update({ status: "cancelled" }).eq("id", bet.id).eq("status", "taken").select("id")
      if (!upd?.length) continue
      const stake = Number(bet.amount)
      await payoutToMode(supabase, bet.creator_id, stake, bet.mode)
      if (bet.acceptor_id) await payoutToMode(supabase, bet.acceptor_id, stake, bet.mode)
      await createNotifications(
        [
          { userId: bet.creator_id, type: "bet_cancelled", title: "Apuesta anulada", body: "Tu apuesta en vivo se anuló y te devolvimos tu monto.", betId: bet.id },
          ...(bet.acceptor_id ? [{ userId: bet.acceptor_id, type: "bet_cancelled" as const, title: "Apuesta anulada", body: "Tu apuesta en vivo se anuló y te devolvimos tu monto.", betId: bet.id }] : []),
        ],
        supabase
      )
      settled++
      continue
    }

    const winnerId = res.winner === "creator" ? bet.creator_id : bet.acceptor_id
    if (!winnerId) continue
    const loserId = res.winner === "creator" ? bet.acceptor_id : bet.creator_id

    const { data: upd } = await supabase
      .from("bets")
      .update({ status: "resolved", winner_id: winnerId, resolved_at: new Date().toISOString() })
      .eq("id", bet.id).eq("status", "taken").select("id")
    if (!upd?.length) continue

    const prize = calculateTotalPrize(bet.amount, bet.multiplier)
    await payoutToMode(supabase, winnerId, prize, bet.mode)
    await createNotifications(
      [
        { userId: winnerId, type: "bet_resolved_win", title: "¡Ganaste!", body: "Tu apuesta en vivo se resolvió a tu favor.", betId: bet.id },
        ...(loserId ? [{ userId: loserId, type: "bet_resolved_loss" as const, title: "Apuesta perdida", body: "Tu apuesta en vivo se resolvió en contra.", betId: bet.id }] : []),
      ],
      supabase
    )
    settled++
  }

  return settled
}
