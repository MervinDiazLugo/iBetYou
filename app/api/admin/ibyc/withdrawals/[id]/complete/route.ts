import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createNotification } from "@/lib/notifications"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { id } = await params
  const { admin_notes } = await request.json().catch(() => ({}))

  const supabase = createAdminSupabaseClient()

  const { data: withdrawal } = await supabase
    .from("ibeyc_withdrawals")
    .select("id, user_id, status, amount_ibyc_net, currency, amount_local")
    .eq("id", id)
    .single()

  if (!withdrawal) return NextResponse.json({ error: "Retiro no encontrado" }, { status: 404 })
  if (!["pending", "processing"].includes(withdrawal.status)) {
    return NextResponse.json({ error: `No se puede completar un retiro en estado: ${withdrawal.status}` }, { status: 409 })
  }

  const { error: updateError } = await supabase
    .from("ibeyc_withdrawals")
    .update({
      status: "completed",
      processed_at: new Date().toISOString(),
      processed_by: auth.userId,
      admin_notes: admin_notes ?? null,
    })
    .eq("id", id)

  if (updateError) return NextResponse.json({ error: "Error actualizando retiro" }, { status: 500 })

  await createNotification({
    userId: withdrawal.user_id,
    type: "withdrawal_completed",
    title: "Retiro procesado",
    body: `Tu retiro de ${Number(withdrawal.amount_local).toFixed(2)} ${withdrawal.currency} fue enviado.`,
  }, supabase)

  return NextResponse.json({ success: true })
}
