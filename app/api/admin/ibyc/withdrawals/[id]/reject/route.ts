import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createNotification } from "@/lib/notifications"

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { reason } = await request.json()
  if (!reason?.trim()) return NextResponse.json({ error: "Motivo de rechazo requerido" }, { status: 400 })

  const supabase = createAdminSupabaseClient()

  const { data: withdrawal } = await supabase
    .from("ibeyc_withdrawals")
    .select("id, user_id, status, amount_ibyc_requested, currency")
    .eq("id", params.id)
    .single()

  if (!withdrawal) return NextResponse.json({ error: "Retiro no encontrado" }, { status: 404 })
  if (!["pending", "processing"].includes(withdrawal.status)) {
    return NextResponse.json({ error: `No se puede rechazar en estado: ${withdrawal.status}` }, { status: 409 })
  }

  const amountToReturn = Number(withdrawal.amount_ibyc_requested)

  // Return funds to user wallet
  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance_real")
    .eq("user_id", withdrawal.user_id)
    .single()

  if (wallet) {
    await supabase
      .from("wallets")
      .update({ balance_real: wallet.balance_real + amountToReturn })
      .eq("user_id", withdrawal.user_id)
      .eq("balance_real", wallet.balance_real)

    await supabase.from("transactions").insert({
      user_id: withdrawal.user_id,
      token_type: "real",
      amount: amountToReturn,
      operation: "ibyc_withdrawal_reversal",
      reference_id: withdrawal.id,
    })
  }

  await supabase
    .from("ibeyc_withdrawals")
    .update({
      status: "rejected",
      rejection_reason: reason.trim(),
      processed_at: new Date().toISOString(),
      processed_by: auth.userId,
    })
    .eq("id", params.id)

  await createNotification({
    userId: withdrawal.user_id,
    type: "withdrawal_rejected",
    title: "Retiro rechazado",
    body: `Tu retiro fue rechazado: ${reason.trim()}. Se devolvieron ${amountToReturn.toFixed(2)} iBYC a tu balance.`,
  }, supabase)

  return NextResponse.json({ success: true, refunded_ibyc: amountToReturn })
}
