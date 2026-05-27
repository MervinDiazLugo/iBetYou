import { createAdminSupabaseClient } from "@/lib/supabase"

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

/**
 * Pays out `amount` to `userId` using the wallet that matches `betMode`.
 * fantasy → wallets.balance_fantasy
 * real    → iby_wallets.balance
 *
 * Uses optimistic locking with retry to prevent double-spend on concurrent payouts.
 */
export async function payoutToMode(
  supabase: AdminClient,
  userId: string,
  amount: number,
  betMode: string
): Promise<void> {
  if (betMode !== "real" && betMode !== "fantasy") {
    throw new Error(`Invalid betMode: ${betMode}`)
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * attempt))
    if (betMode === "real") {
      const { data: w } = await supabase
        .from("iby_wallets")
        .select("balance")
        .eq("user_id", userId)
        .single()
      if (!w) throw new Error(`payoutToMode: iby_wallet not found for user ${userId}`)
      const { data: updated } = await supabase
        .from("iby_wallets")
        .update({ balance: Number(w.balance) + amount })
        .eq("user_id", userId)
        .eq("balance", w.balance)
        .select("user_id")
      if (updated && updated.length > 0) return
    } else {
      const { data: w } = await supabase
        .from("wallets")
        .select("balance_fantasy")
        .eq("user_id", userId)
        .single()
      if (!w) throw new Error(`payoutToMode: wallet not found for user ${userId}`)
      const { data: updated } = await supabase
        .from("wallets")
        .update({ balance_fantasy: Number(w.balance_fantasy) + amount })
        .eq("user_id", userId)
        .eq("balance_fantasy", w.balance_fantasy)
        .select("user_id")
      if (updated && updated.length > 0) return
    }
  }
  throw new Error(`payoutToMode: failed after 3 attempts for user ${userId}`)
}

export function tokenTypeForMode(betMode: string): string {
  if (betMode !== "real" && betMode !== "fantasy") {
    throw new Error(`Invalid betMode: ${betMode}`)
  }
  return betMode === "real" ? "iBY" : "fantasy"
}
