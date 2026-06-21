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

  // Read wallet for optimistic lock
  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance_real")
    .eq("user_id", deposit.user_id)
    .single()

  if (!wallet) return NextResponse.json({ error: "Wallet de usuario no encontrada" }, { status: 404 })

  const amountIbyc = Number(deposit.amount_ibyc)
  const newBalance = wallet.balance_real + amountIbyc

  // Credit wallet (optimistic lock — verifies balance unchanged since read)
  const { data: credited, error: creditError } = await supabase
    .from("wallets")
    .update({ balance_real: newBalance })
    .eq("user_id", deposit.user_id)
    .eq("balance_real", wallet.balance_real)
    .select("balance_real")
    .single()

  if (creditError || !credited) {
    return NextResponse.json({ error: "Conflicto de balance. Intente de nuevo." }, { status: 409 })
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
