import { createAdminSupabaseClient } from "@/lib/supabase"

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export async function houseWalletDebit(
  supabase: AdminClient,
  amount: number,
  mode: "fantasy" | "real"
): Promise<void> {
  const field = mode === "real" ? "balance_real" : "balance_fantasy"
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: w } = await supabase
      .from("house_wallet")
      .select(field)
      .eq("id", 1)
      .single()
    if (!w) throw new Error("house_wallet row not found")
    const current = Number((w as any)[field])
    if (current < amount) throw new Error(`Casa sin fondos suficientes (${mode})`)
    const { data: updated } = await supabase
      .from("house_wallet")
      .update({ [field]: current - amount, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .eq(field, current)
      .select("id")
    if (updated && updated.length > 0) return
  }
  throw new Error("houseWalletDebit: failed after 3 attempts")
}

export async function houseWalletCredit(
  supabase: AdminClient,
  amount: number,
  mode: "fantasy" | "real"
): Promise<void> {
  const field = mode === "real" ? "balance_real" : "balance_fantasy"
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: w } = await supabase
      .from("house_wallet")
      .select(field)
      .eq("id", 1)
      .single()
    if (!w) throw new Error("house_wallet row not found")
    const current = Number((w as any)[field])
    const { data: updated } = await supabase
      .from("house_wallet")
      .update({ [field]: current + amount, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .eq(field, current)
      .select("id")
    if (updated && updated.length > 0) return
  }
  throw new Error("houseWalletCredit: failed after 3 attempts")
}

export async function getHouseWalletBalances(
  supabase: AdminClient
): Promise<{ balance_fantasy: number; balance_real: number }> {
  const { data, error } = await supabase
    .from("house_wallet")
    .select("balance_fantasy, balance_real")
    .eq("id", 1)
    .single()
  if (error || !data) throw new Error("house_wallet not found")
  return { balance_fantasy: Number(data.balance_fantasy), balance_real: Number(data.balance_real) }
}
