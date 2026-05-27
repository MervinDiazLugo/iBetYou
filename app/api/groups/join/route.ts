import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { canCountryUseGroups } from "@/lib/country-access"

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { code } = await request.json() as { code?: string }
  if (!code?.trim()) return NextResponse.json({ error: "El código de invitación es requerido" }, { status: 400 })

  const supabase = createAdminSupabaseClient()

  const { data: profile } = await supabase.from("profiles").select("role, country").eq("id", userId).single()
  if (profile?.role === "backoffice_admin") return NextResponse.json({ error: "Los admins no pueden unirse a grupos" }, { status: 403 })
  if (!(await canCountryUseGroups(profile?.country ?? null))) {
    return NextResponse.json({ error: "Los grupos no están disponibles en tu país" }, { status: 403 })
  }

  const { data: group } = await supabase
    .from("groups")
    .select("id, name, status")
    .eq("code", code.trim().toUpperCase())
    .single()

  if (!group) return NextResponse.json({ error: "Código de invitación incorrecto" }, { status: 404 })
  if (group.status === "archived") return NextResponse.json({ error: "Este grupo está archivado" }, { status: 400 })

  const { data: existing } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", group.id)
    .eq("user_id", userId)
    .maybeSingle()

  if (existing) return NextResponse.json({ error: "Ya eres miembro de este grupo" }, { status: 409 })

  const { error: memberError } = await supabase
    .from("group_members")
    .insert({ group_id: group.id, user_id: userId, role: "member" })

  if (memberError) {
    if (memberError.message.includes("unique") || memberError.code === "23505") {
      return NextResponse.json({ error: "Ya eres miembro de este grupo" }, { status: 409 })
    }
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  const { error: walletError } = await supabase
    .from("group_wallets")
    .insert({ group_id: group.id, user_id: userId, balance: 0 })

  if (walletError) {
    // Best-effort rollback — remove the member row so state stays consistent
    await supabase
      .from("group_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", userId)
    console.error("GROUP_WALLET_CREATE_FAILED", { groupId: group.id, userId, error: walletError.message })
    return NextResponse.json({ error: "Error creando wallet del grupo" }, { status: 500 })
  }

  return NextResponse.json({ success: true, group_id: group.id, group_name: group.name })
}
