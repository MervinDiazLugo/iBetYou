import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: groupId } = await context.params
  const supabase = createAdminSupabaseClient()

  const { data: membership } = await supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", userId).maybeSingle()
  if (!membership) return NextResponse.json({ error: "No eres miembro de este grupo" }, { status: 403 })

  const [membersRes, resolvedBetsRes] = await Promise.all([
    supabase.from("group_members").select("user_id, profile:profiles(nickname, avatar_url), wallet:group_wallets(balance)").eq("group_id", groupId),
    supabase.from("bets").select("winner_id, amount").eq("group_id", groupId).eq("status", "resolved").not("winner_id", "is", null),
  ])

  const members = membersRes.data || []
  const resolvedBets = resolvedBetsRes.data || []

  const winMap = new Map<string, { total_won: number; total_wins: number }>()
  for (const m of members) winMap.set(m.user_id, { total_won: 0, total_wins: 0 })
  for (const bet of resolvedBets) {
    if (!bet.winner_id || !winMap.has(bet.winner_id)) continue
    const entry = winMap.get(bet.winner_id)!
    entry.total_won += Number(bet.amount) * 2
    entry.total_wins += 1
  }

  const leaderboard = members
    .map((m: any) => {
      const stats = winMap.get(m.user_id) ?? { total_won: 0, total_wins: 0 }
      const wallet = Array.isArray(m.wallet) ? m.wallet[0] : m.wallet
      return {
        user_id: m.user_id,
        nickname: m.profile?.nickname ?? m.user_id.slice(0, 8),
        avatar_url: m.profile?.avatar_url ?? null,
        balance: Number(wallet?.balance ?? 0),
        total_won: stats.total_won,
        total_wins: stats.total_wins,
      }
    })
    .sort((a: any, b: any) => b.total_won - a.total_won)

  return NextResponse.json({ leaderboard })
}
