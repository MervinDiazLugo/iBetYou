import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await context.params
  const { action, notification_id } = await request.json() as { action?: string; notification_id?: string }

  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 })
  }
  if (!notification_id) return NextResponse.json({ error: "notification_id requerido" }, { status: 400 })

  const supabase = createAdminSupabaseClient()

  // Verify the notification belongs to this user and this group
  const { data: notif } = await supabase
    .from("notifications")
    .select("id, group_id, type")
    .eq("id", notification_id)
    .eq("user_id", userId)
    .eq("type", "group_invite")
    .maybeSingle()

  if (!notif) return NextResponse.json({ error: "Invitación no encontrada" }, { status: 404 })
  if (notif.group_id !== groupId) return NextResponse.json({ error: "Invitación inválida" }, { status: 400 })

  // Delete notification — once acted upon it shouldn't reappear
  await supabase.from("notifications").delete().eq("id", notification_id)

  if (action === "decline") {
    return NextResponse.json({ success: true, joined: false })
  }

  // Accept: check not already a member
  const { data: existing } = await supabase.from("group_members").select("user_id").eq("group_id", groupId).eq("user_id", userId).maybeSingle()
  if (existing) return NextResponse.json({ success: true, joined: false, message: "Ya eres miembro" })

  // Check group still active
  const { data: group } = await supabase.from("groups").select("name, status").eq("id", groupId).single()
  if (!group || group.status === "archived") {
    return NextResponse.json({ error: "Este grupo ya no está disponible" }, { status: 400 })
  }

  const { error: memberErr } = await supabase.from("group_members").insert({ group_id: groupId, user_id: userId, role: "member" })
  if (memberErr) {
    if (memberErr.code === "23505") return NextResponse.json({ success: true, joined: false, message: "Ya eres miembro" })
    return NextResponse.json({ error: memberErr.message }, { status: 500 })
  }

  const { error: walletErr } = await supabase.from("group_wallets").insert({ group_id: groupId, user_id: userId, balance: 0 })
  if (walletErr) {
    await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId)
    return NextResponse.json({ error: "Error creando wallet del grupo" }, { status: 500 })
  }

  return NextResponse.json({ success: true, joined: true, group_name: group.name })
}
