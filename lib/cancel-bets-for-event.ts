import { createAdminSupabaseClient } from "@/lib/supabase"
import { payoutToMode, tokenTypeForMode } from "@/lib/wallet-utils"
import { createNotifications } from "@/lib/notifications"
import { creditGroupWallet } from "@/lib/group-wallet-utils"

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

const ACTIVE_STATUSES = ["open", "taken", "pending_resolution", "pending_resolution_creator", "pending_resolution_acceptor", "disputed"]

export async function cancelBetsForEvent(
  supabase: AdminClient,
  eventId: number,
  reason = "Evento pospuesto o cancelado"
): Promise<{ cancelled: number; failed: number }> {
  let cancelled = 0
  let failed = 0

  const { data: bets, error } = await supabase
    .from("bets")
    .select("id, creator_id, acceptor_id, amount, fee_amount, multiplier, bet_type, status, mode, group_id")
    .eq("event_id", eventId)
    .in("status", ACTIVE_STATUSES)

  if (error || !bets) return { cancelled, failed }

  for (const bet of bets) {
    // 1. Cancel bet first (payment ordering invariant)
    const { data: rows, error: cancelError } = await supabase
      .from("bets")
      .update({ status: "cancelled" })
      .eq("id", bet.id)
      .in("status", ACTIVE_STATUSES)
      .select("id")

    if (cancelError || !rows || rows.length === 0) {
      failed++
      continue
    }

    const betMode = bet.mode === "real" ? "real" : "fantasy"
    const groupId = (bet as any).group_id ?? null
    const creatorStake = Number(bet.amount)
    const creatorFee = Number(bet.fee_amount)
    const isAsymmetric = bet.bet_type === "exact_score"
    const acceptorStake = isAsymmetric ? creatorStake * Math.max(1, Number(bet.multiplier)) : creatorStake
    const acceptorFee = groupId ? 0 : acceptorStake * 0.03

    // 2. Refund creator
    try {
      if (groupId) {
        await creditGroupWallet(supabase, groupId, bet.creator_id, creatorStake + creatorFee)
        await supabase.from("transactions").insert({
          user_id: bet.creator_id,
          token_type: "group_fantasy",
          amount: creatorStake + creatorFee,
          operation: "bet_cancelled_event_postponed",
          reference_id: bet.id,
        })
      } else {
        await payoutToMode(supabase, bet.creator_id, creatorStake + creatorFee, betMode)
        await supabase.from("transactions").insert({
          user_id: bet.creator_id,
          token_type: tokenTypeForMode(betMode),
          amount: creatorStake + creatorFee,
          operation: "bet_cancelled_event_postponed",
          reference_id: bet.id,
        })
      }
    } catch (err) {
      console.error("REFUND_FAILED creator event_postponed", { betId: bet.id, userId: bet.creator_id, err })
      failed++
      continue
    }

    // 3. Refund acceptor if bet was taken
    const hasTwoParties = bet.acceptor_id && bet.status !== "open"
    if (hasTwoParties) {
      try {
        if (groupId) {
          await creditGroupWallet(supabase, groupId, bet.acceptor_id!, acceptorStake + acceptorFee)
          await supabase.from("transactions").insert({
            user_id: bet.acceptor_id,
            token_type: "group_fantasy",
            amount: acceptorStake + acceptorFee,
            operation: "bet_cancelled_event_postponed",
            reference_id: bet.id,
          })
        } else {
          await payoutToMode(supabase, bet.acceptor_id!, acceptorStake + acceptorFee, betMode)
          await supabase.from("transactions").insert({
            user_id: bet.acceptor_id,
            token_type: tokenTypeForMode(betMode),
            amount: acceptorStake + acceptorFee,
            operation: "bet_cancelled_event_postponed",
            reference_id: bet.id,
          })
        }
      } catch (err) {
        console.error("REFUND_FAILED acceptor event_postponed", { betId: bet.id, userId: bet.acceptor_id, err })
        // Don't increment failed — creator was already refunded; log for manual recovery
      }
    }

    // 4. Record in arbitration_decisions
    await supabase.from("arbitration_decisions").insert({
      bet_id: bet.id,
      action: "event_postponed",
      previous_status: bet.status,
      new_status: "cancelled",
      decided_winner_id: null,
      reason,
      details: { event_id: eventId, creator_refund: creatorStake + creatorFee, acceptor_refund: hasTwoParties ? acceptorStake + acceptorFee : 0 },
      decided_by: "system",
      source: "system",
    })

    // 5. Notify participants
    const notifications: Parameters<typeof createNotifications>[0] = [
      {
        userId: bet.creator_id,
        type: "bet_cancelled",
        title: "Apuesta cancelada — evento pospuesto",
        body: `El evento fue pospuesto. Se reembolsaron ${(creatorStake + creatorFee).toFixed(2)} tokens.`,
        betId: bet.id,
        mode: betMode,
      },
    ]
    if (hasTwoParties && bet.acceptor_id) {
      notifications.push({
        userId: bet.acceptor_id,
        type: "bet_cancelled",
        title: "Apuesta cancelada — evento pospuesto",
        body: `El evento fue pospuesto. Se reembolsaron ${(acceptorStake + acceptorFee).toFixed(2)} tokens.`,
        betId: bet.id,
        mode: betMode,
      })
    }
    await createNotifications(notifications, supabase)

    cancelled++
  }

  return { cancelled, failed }
}
