import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createNotification } from "@/lib/notifications"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { id } = await params
  const supabase = createAdminSupabaseClient()

  const { data: deposit } = await supabase
    .from("ibeyc_deposits")
    .select("id, user_id, amount_ibyc, currency, status")
    .eq("id", id)
    .single()

  if (!deposit) return NextResponse.json({ error: "Depósito no encontrado" }, { status: 404 })
  if (deposit.status !== "proof_submitted") {
    return NextResponse.json({ error: `No se puede aprobar un depósito en estado: ${deposit.status}` }, { status: 409 })
  }

  const amountIbyc = Number(deposit.amount_ibyc)

  // Read iby_wallets for optimistic lock
  const { data: ibcWallet } = await supabase
    .from("iby_wallets")
    .select("balance, balance_blocked")
    .eq("user_id", deposit.user_id)
    .single()

  let newBalance: number

  if (!ibcWallet) {
    // Wallet doesn't exist yet — create it with the deposit amount
    const { data: created, error: createError } = await supabase
      .from("iby_wallets")
      .insert({ user_id: deposit.user_id, balance: amountIbyc })
      .select("balance")
      .single()
    if (createError || !created) {
      return NextResponse.json({ error: "Error creando wallet. Intente de nuevo." }, { status: 500 })
    }
    newBalance = amountIbyc
  } else {
    newBalance = Number(ibcWallet.balance) + amountIbyc
    // Credit wallet (optimistic lock — verifies balance unchanged since read)
    const { data: credited, error: creditError } = await supabase
      .from("iby_wallets")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", deposit.user_id)
      .eq("balance", ibcWallet.balance)
      .select("balance")
      .single()
    if (creditError || !credited) {
      return NextResponse.json({ error: "Conflicto de balance. Intente de nuevo." }, { status: 409 })
    }
  }

  // Mark deposit confirmed
  await supabase
    .from("ibeyc_deposits")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: auth.userId })
    .eq("id", id)

  // Audit
  await supabase.from("transactions").insert({
    user_id: deposit.user_id,
    token_type: "real",
    amount: amountIbyc,
    operation: "ibyc_deposit",
    reference_id: deposit.id,
  })

  // Notify user
  await createNotification({
    userId: deposit.user_id,
    type: "deposit_confirmed",
    title: "Depósito confirmado",
    body: `Tu depósito de ${amountIbyc.toFixed(2)} iBYC ha sido acreditado.`,
  }, supabase)

  return NextResponse.json({ success: true, amount_ibyc: amountIbyc, new_balance: newBalance })
}
