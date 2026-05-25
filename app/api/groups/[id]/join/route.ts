import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await context.params
  const { code } = await request.json() as { code?: string }

  if (!code?.trim()) return NextResponse.json({ error: "El código de invitación es requerido" }, { status: 400 })

  const supabase = createAdminSupabaseClient()

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single()
  if (profile?.role === "backoffice_admin") return NextResponse.json({ error: "Los admins no pueden unirse a grupos" }, { status: 403 })

  const { data: group } = await supabase.from("groups").select("id, name, code, status").eq("id", groupId).single()
  if (!group) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 })
  if (group.code.toUpperCase() !== code.trim().toUpperCase()) return NextResponse.json({ error: "Código de invitación incorrecto" }, { status: 400 })
  if (group.status === "archived") return NextResponse.json({ error: "Este grupo está archivado" }, { status: 400 })

  const { data: existing } = await supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", userId).maybeSingle()
  if (existing) return NextResponse.json({ error: "Ya eres miembro de este grupo" }, { status: 409 })

  await supabase.from("group_members").insert({ group_id: groupId, user_id: userId, role: "member" })
  await supabase.from("group_wallets").insert({ group_id: groupId, user_id: userId, balance: 0 })

  return NextResponse.json({ success: true, group_id: groupId, group_name: group.name })
}
