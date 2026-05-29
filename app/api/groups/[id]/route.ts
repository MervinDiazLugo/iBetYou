import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await context.params
  const supabase = createAdminSupabaseClient()

  const [groupRes, membershipRes] = await Promise.all([
    supabase.from("groups").select("*").eq("id", groupId).single(),
    supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", userId).maybeSingle(),
  ])

  if (groupRes.error || !groupRes.data) return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 })
  if (!membershipRes.data) return NextResponse.json({ error: "No eres miembro de este grupo" }, { status: 403 })

  const [membersRes, walletRes] = await Promise.all([
    supabase.from("group_members").select("user_id, role, joined_at, profile:profiles(nickname, avatar_url)").eq("group_id", groupId).order("joined_at"),
    supabase.from("group_wallets").select("balance, last_daily_grant").eq("group_id", groupId).eq("user_id", userId).single(),
  ])

  return NextResponse.json({
    group: groupRes.data,
    members: membersRes.data || [],
    my_role: membershipRes.data.role,
    my_wallet: walletRes.data || { balance: 0, last_daily_grant: null },
  })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await context.params
  const supabase = createAdminSupabaseClient()

  const { data: membership } = await supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", userId).maybeSingle()
  if (!membership) return NextResponse.json({ error: "No eres miembro de este grupo" }, { status: 403 })
  if (membership.role !== "admin") return NextResponse.json({ error: "Solo los admins pueden modificar el grupo" }, { status: 403 })

  const { name, status, leagues } = await request.json() as { name?: string; status?: string; leagues?: string[] }
  const updates: Record<string, unknown> = {}

  if (name !== undefined) {
    if (!name.trim()) return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 })
    if (name.trim().length > 40) return NextResponse.json({ error: "El nombre no puede superar 40 caracteres" }, { status: 400 })
    updates.name = name.trim()
  }
  if (status === "archived") updates.status = "archived"

  if (leagues !== undefined) {
    if (!Array.isArray(leagues)) return NextResponse.json({ error: "leagues debe ser un arreglo" }, { status: 400 })
    const cleanLeagues = leagues.map((l: string) => l.trim()).filter(Boolean)

    // Check which leagues are being removed — block if active group bets exist for those events
    const { data: currentGroup } = await supabase.from("groups").select("leagues").eq("id", groupId).single()
    const currentLeagues: string[] = currentGroup?.leagues || []
    const removedLeagues = currentLeagues.filter(l => !cleanLeagues.includes(l))

    if (removedLeagues.length > 0) {
      // Find events in removed leagues that have open/taken bets in this group
      const { data: blockedBets } = await supabase
        .from("bets")
        .select("event:events(league)")
        .eq("group_id", groupId)
        .in("status", ["open", "taken"])
      const blockedLeagues = new Set<string>()
      for (const b of blockedBets || []) {
        const league = (b.event as any)?.league
        if (league && removedLeagues.includes(league)) blockedLeagues.add(league)
      }
      if (blockedLeagues.size > 0) {
        return NextResponse.json({
          error: `No puedes quitar estos torneos porque tienen apuestas activas: ${[...blockedLeagues].join(", ")}`,
        }, { status: 422 })
      }
    }
    updates.leagues = cleanLeagues
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 })

  const { data, error } = await supabase.from("groups").update(updates).eq("id", groupId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, group: data })
}
