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

  const { data: deposit } = await supabase
    .from("ibeyc_deposits")
    .select("id, user_id, status, currency, amount_ibyc")
    .eq("id", params.id)
    .single()

  if (!deposit) return NextResponse.json({ error: "Depósito no encontrado" }, { status: 404 })
  if (!["pending", "proof_submitted"].includes(deposit.status)) {
    return NextResponse.json({ error: `No se puede rechazar un depósito en estado: ${deposit.status}` }, { status: 409 })
  }

  await supabase
    .from("ibeyc_deposits")
    .update({ status: "failed", failed_reason: reason.trim(), confirmed_by: auth.userId })
    .eq("id", params.id)

  await createNotification({
    userId: deposit.user_id,
    type: "deposit_rejected",
    title: "Depósito rechazado",
    body: `Tu depósito fue rechazado: ${reason.trim()}`,
  }, supabase)

  return NextResponse.json({ success: true })
}
