import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { NON_FINAL_BET_STATUSES } from "@/lib/bet-constants"

export async function GET() {
  const supabase = createAdminSupabaseClient()

  try {
    // Single query for all bets — split into resolved/active in JS
    const { data: allBets } = await supabase
      .from("bets")
      .select("id, creator_id, acceptor_id, winner_id, bet_type, status, resolved_at, event:events(home_team, away_team, league, sport)")

    const resolvedBets = (allBets || [])
      .filter((b) => b.status === "resolved")
      .sort((a, b) => (b.resolved_at ?? "").localeCompare(a.resolved_at ?? ""))

    // Active bets count
    const activeBetsCount = (allBets || []).filter((b) =>
      (NON_FINAL_BET_STATUSES as readonly string[]).includes(b.status)
    ).length

    // ── User win stats ─────────────────────────────────────────────────────
    const userMap: Record<string, { wins: number; participated: number; recentWins: number }> = {}
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    for (const bet of resolvedBets || []) {
      const participants = [bet.creator_id, bet.acceptor_id].filter(Boolean) as string[]
      for (const uid of participants) {
        if (!userMap[uid]) userMap[uid] = { wins: 0, participated: 0, recentWins: 0 }
        userMap[uid].participated++
        if (bet.winner_id === uid) {
          userMap[uid].wins++
          if (bet.resolved_at && bet.resolved_at >= thirtyDaysAgo) {
            userMap[uid].recentWins++
          }
        }
      }
    }

    const userIds = Object.keys(userMap)
    const { data: profiles } = userIds.length > 0
      ? await supabase.from("profiles").select("id, nickname, avatar_url").in("id", userIds).eq("is_banned", false)
      : { data: [] }

    const profileMap: Record<string, { nickname: string; avatar_url: string | null }> = {}
    for (const p of profiles || []) {
      profileMap[p.id] = { nickname: p.nickname, avatar_url: p.avatar_url }
    }

    // Build ranking entries (only users with profiles)
    const rankingEntries = Object.entries(userMap)
      .filter(([uid]) => profileMap[uid])
      .map(([uid, stats]) => ({
        nickname: profileMap[uid].nickname,
        avatar_url: profileMap[uid].avatar_url,
        wins: stats.wins,
        participated: stats.participated,
        losses: stats.participated - stats.wins,
        winRate: stats.participated > 0 ? Math.round((stats.wins / stats.participated) * 100) : 0,
        recentWins: stats.recentWins,
      }))

    // ── Top by wins ────────────────────────────────────────────────────────
    const topByWins = [...rankingEntries]
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
      .slice(0, 10)

    // ── Top by win rate (min 3 participated) ──────────────────────────────
    const topByRate = [...rankingEntries]
      .filter((e) => e.participated >= 3)
      .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins)
      .slice(0, 10)

    // ── Most active ────────────────────────────────────────────────────────
    const topByActivity = [...rankingEntries]
      .sort((a, b) => b.participated - a.participated)
      .slice(0, 10)

    // ── Hot right now (most wins in last 30 days) ─────────────────────────
    const topHot = [...rankingEntries]
      .filter((e) => e.recentWins > 0)
      .sort((a, b) => b.recentWins - a.recentWins)
      .slice(0, 5)

    // ── Platform stats ─────────────────────────────────────────────────────
    const totalResolved = (resolvedBets || []).length
    const totalBets = (allBets || []).length

    // Bet type popularity
    const betTypeCounts: Record<string, number> = {}
    for (const b of allBets || []) {
      betTypeCounts[b.bet_type] = (betTypeCounts[b.bet_type] || 0) + 1
    }

    // Top leagues
    const leagueCounts: Record<string, number> = {}
    for (const b of allBets || []) {
      const league = (b.event as any)?.league
      if (league) leagueCounts[league] = (leagueCounts[league] || 0) + 1
    }
    const topLeagues = Object.entries(leagueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }))

    // Recent resolved (last 8, no money info)
    const recentResolved = resolvedBets.slice(0, 8).map((b) => {
      const event = Array.isArray(b.event) ? b.event[0] : b.event
      const winnerProfile = b.winner_id ? profileMap[b.winner_id] : null
      return {
        betId: b.id,
        winnerNickname: winnerProfile?.nickname || null,
        winnerAvatar: winnerProfile?.avatar_url || null,
        betType: b.bet_type,
        homeTeam: event?.home_team || "",
        awayTeam: event?.away_team || "",
        league: event?.league || "",
        sport: event?.sport || "",
        resolvedAt: b.resolved_at,
      }
    })

    return NextResponse.json({
      rankings: {
        topByWins,
        topByRate,
        topByActivity,
        topHot,
      },
      platform: {
        totalBets,
        totalResolved,
        activeBetsCount,
        totalParticipants: rankingEntries.length,
        betTypeCounts,
        topLeagues,
      },
      recentResolved,
    })
  } catch (error) {
    console.error("Stats error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
