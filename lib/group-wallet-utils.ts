import { createAdminSupabaseClient } from "@/lib/supabase"

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

const DAILY_GRANT_AMOUNT = 1000

export async function ensureDailyGrant(
  supabase: AdminClient,
  groupId: string,
  userId: string
): Promise<boolean> {
  const todayUTC = new Date().toISOString().split("T")[0]

  const { data: gw } = await supabase
    .from("group_wallets")
    .select("balance, last_daily_grant")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .single()

  if (!gw) throw new Error(`Group wallet not found for user ${userId}`)
  if (gw.last_daily_grant === todayUTC) return false

  // Optimistic lock: only grant if last_daily_grant hasn't changed since we read it,
  // preventing double-grant when two concurrent requests both see an un-granted day.
  const { data: updated } = await supabase
    .from("group_wallets")
    .update({
      balance: Number(gw.balance) + DAILY_GRANT_AMOUNT,
      last_daily_grant: todayUTC,
    })
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .neq("last_daily_grant", todayUTC)
    .select("user_id")

  return !!(updated && updated.length > 0)
}

export async function deductFromGroupWallet(
  supabase: AdminClient,
  groupId: string,
  userId: string,
  amount: number
): Promise<void> {
  const { data: gw } = await supabase
    .from("group_wallets")
    .select("balance")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .single()

  if (!gw) throw new Error("Group wallet not found")

  const current = Number(gw.balance)
  if (current < amount) throw new Error("Saldo de grupo insuficiente")

  const { data: updated } = await supabase
    .from("group_wallets")
    .update({ balance: current - amount })
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .eq("balance", current)
    .select("user_id")

  if (!updated || updated.length === 0) {
    throw new Error("Tu saldo de grupo cambió. Intenta de nuevo.")
  }
}

export async function creditGroupWallet(
  supabase: AdminClient,
  groupId: string,
  userId: string,
  amount: number
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * attempt))

    const { data: gw } = await supabase
      .from("group_wallets")
      .select("balance")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .single()

    if (!gw) throw new Error(`Group wallet not found for user ${userId}`)

    const { data: updated } = await supabase
      .from("group_wallets")
      .update({ balance: Number(gw.balance) + amount })
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .eq("balance", gw.balance)
      .select("user_id")

    if (updated && updated.length > 0) return
  }
  throw new Error(`creditGroupWallet: failed after 3 attempts for user ${userId}`)
}
