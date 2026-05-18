import { createAdminSupabaseClient } from "@/lib/supabase"

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

/**
 * Pays out `amount` to `userId` using the wallet that matches `betMode`.
 * fantasy → wallets.balance_fantasy
 * real    → iby_wallets.balance
 */
export async function payoutToMode(
  supabase: AdminClient,
  userId: string,
  amount: number,
  betMode: string
): Promise<void> {
  if (betMode === "real") {
    const { data: w } = await supabase
      .from("iby_wallets")
      .select("balance")
      .eq("user_id", userId)
      .single()
    if (w) {
      await supabase
        .from("iby_wallets")
        .update({ balance: Number(w.balance) + amount })
        .eq("user_id", userId)
    }
  } else {
    const { data: w } = await supabase
      .from("wallets")
      .select("balance_fantasy")
      .eq("user_id", userId)
      .single()
    if (w) {
      await supabase
        .from("wallets")
        .update({ balance_fantasy: Number(w.balance_fantasy) + amount })
        .eq("user_id", userId)
    }
  }
}

export function tokenTypeForMode(betMode: string): string {
  return betMode === "real" ? "ibc" : "fantasy"
}
