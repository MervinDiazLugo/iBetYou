import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { id } = await context.params
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 })

  const supabase = createAdminSupabaseClient()

  const updates: Record<string, unknown> = {}
  if (body.label !== undefined) updates.label = body.label
  if (body.details !== undefined) updates.details = body.details
  if (body.is_active !== undefined) updates.is_active = body.is_active

  const { data: account, error } = await supabase
    .from("deposit_accounts")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, account })
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { id } = await context.params
  const supabase = createAdminSupabaseClient()

  // Soft delete — deactivate instead of removing
  const { error } = await supabase
    .from("deposit_accounts")
    .update({ is_active: false })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
