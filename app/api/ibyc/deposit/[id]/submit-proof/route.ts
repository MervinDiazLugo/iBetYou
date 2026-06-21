import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { proof_reference } = await request.json()
  if (!proof_reference || typeof proof_reference !== "string" || proof_reference.trim().length < 3) {
    return NextResponse.json({ error: "Referencia de transacción inválida" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()

  const { data: deposit } = await supabase
    .from("ibeyc_deposits")
    .select("id, user_id, status")
    .eq("id", params.id)
    .single()

  if (!deposit) return NextResponse.json({ error: "Depósito no encontrado" }, { status: 404 })
  if (deposit.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (deposit.status !== "pending") {
    return NextResponse.json({ error: "Solo se puede enviar comprobante a depósitos pendientes" }, { status: 409 })
  }

  const { error } = await supabase
    .from("ibeyc_deposits")
    .update({ proof_reference: proof_reference.trim(), status: "proof_submitted" })
    .eq("id", params.id)

  if (error) return NextResponse.json({ error: "Error actualizando depósito" }, { status: 500 })

  return NextResponse.json({ success: true })
}
