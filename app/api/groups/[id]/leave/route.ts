import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await context.params
  const supabase = createAdminSupabaseClient()

  const { data: membership } = await supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", userId).maybeSingle()
  if (!membership) return NextResponse.json({ error: "No eres miembro de este grupo" }, { status: 403 })

  if (membership.role === "admin") {
    const { data: members } = await supabase.from("group_members").select("user_id, role").eq("group_id", groupId)
    const admins = (members || []).filter((m) => m.role === "admin")
    const total = (members || []).length
    if (admins.length === 1 && total > 1) {
      return NextResponse.json({ error: "Eres el único admin. Transfiere el rol a otro miembro antes de salir." }, { status: 400 })
    }
  }

  await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId)
  await supabase.from("group_wallets").delete().eq("group_id", groupId).eq("user_id", userId)

  return NextResponse.json({ success: true })
}
