import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await context.params
  const supabase = createAdminSupabaseClient()

  // Must be admin
  const { data: membership } = await supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", userId).maybeSingle()
  if (!membership) return NextResponse.json({ error: "No eres miembro de este grupo" }, { status: 403 })
  if (membership.role !== "admin") return NextResponse.json({ error: "Solo los admins pueden invitar" }, { status: 403 })

  const { nickname } = await request.json() as { nickname?: string }
  if (!nickname?.trim()) return NextResponse.json({ error: "Nickname requerido" }, { status: 400 })

  // Find target user
  const { data: target } = await supabase.from("profiles").select("id, nickname").ilike("nickname", nickname.trim()).maybeSingle()
  if (!target) return NextResponse.json({ error: `No se encontró el usuario "${nickname.trim()}"` }, { status: 404 })
  if (target.id === userId) return NextResponse.json({ error: "No puedes invitarte a ti mismo" }, { status: 400 })

  // Already a member?
  const { data: alreadyMember } = await supabase.from("group_members").select("user_id").eq("group_id", groupId).eq("user_id", target.id).maybeSingle()
  if (alreadyMember) return NextResponse.json({ error: `${target.nickname} ya es miembro del grupo` }, { status: 409 })

  // Pending invite already sent?
  const { data: pending } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", target.id)
    .eq("type", "group_invite")
    .eq("group_id", groupId)
    .eq("read", false)
    .maybeSingle()
  if (pending) return NextResponse.json({ error: `Ya hay una invitación pendiente para ${target.nickname}` }, { status: 409 })

  // Get group name and inviter nickname
  const [{ data: group }, { data: inviter }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", groupId).single(),
    supabase.from("profiles").select("nickname").eq("id", userId).single(),
  ])

  await supabase.from("notifications").insert({
    user_id: target.id,
    type: "group_invite",
    title: `Invitación al grupo "${group?.name ?? "grupo"}"`,
    body: `${inviter?.nickname ?? "Un usuario"} te invita a unirte al grupo.`,
    group_id: groupId,
  })

  return NextResponse.json({ success: true })
}
