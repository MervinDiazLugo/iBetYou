import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await context.params
  const supabase = createAdminSupabaseClient()

  const [groupRes, membershipRes] = await Promise.all([
    supabase.from("groups").select("id, sport, league, status").eq("id", groupId).single(),
    supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", userId).maybeSingle(),
  ])

  if (!groupRes.data) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 })
  if (!membershipRes.data) return NextResponse.json({ error: "No eres miembro de este grupo" }, { status: 403 })

  const { data: bets, error } = await supabase
    .from("bets")
    .select("*, event:events(*), creator:profiles!creator_id(nickname, avatar_url)")
    .eq("group_id", groupId)
    .eq("status", "open")
    .neq("creator_id", userId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bets: bets || [] })
}
