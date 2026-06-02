import { NextRequest, NextResponse } from "next/server"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createAdminSupabaseClient } from "@/lib/supabase"

function parsePercent(val: string | undefined): number {
  if (!val) return 0
  return parseFloat(String(val).replace("%", "")) / 100
}

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { searchParams } = new URL(request.url)
  const betsPerEvent = Math.min(500, Math.max(1, Number(searchParams.get("bets_per_event") ?? 50)))
  const avgAmount = Math.min(10000, Math.max(1, Number(searchParams.get("avg_amount") ?? 10)))

  const supabase = createAdminSupabaseClient()

  const { data: events, error } = await supabase
    .from("events")
    .select("id, sport, league, home_team, away_team, start_time, metadata")
    .eq("featured", true)
    .in("status", ["scheduled", "live"])
    .order("start_time", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!events?.length) return NextResponse.json({ events: [], summary: null })

  const results = events
    .filter(ev => (ev.metadata as any)?.predictions?.percent)
    .map(ev => {
      const pred = (ev.metadata as any).predictions
      const pct = pred.percent

      const homeProb = parsePercent(pct.home)
      const awayProb = parsePercent(pct.away)
      const drawProb = pct.draw ? parsePercent(pct.draw) : 0

      // Normalize (in case they don't sum to exactly 1)
      const total = homeProb + awayProb + drawProb
      const pH = homeProb / total
      const pA = awayProb / total
      const pD = drawProb / total

      // House odds (10% margin baked in)
      const oHome = pH > 0 ? 1 / (pH * 1.10) : 0
      const oAway = pA > 0 ? 1 / (pA * 1.10) : 0
      const oDraw = pD > 0 ? 1 / (pD * 1.10) : 0

      // Distribute bets proportionally to probabilities (users tend to bet favorites)
      const nHome = Math.round(betsPerEvent * pH)
      const nAway = Math.round(betsPerEvent * pA)
      const nDraw = betsPerEvent - nHome - nAway

      const volume = betsPerEvent * avgAmount

      // Expected house P&L (math): EV per bet = stake × (1 - prob × odds) ≈ 9.09% margin
      // For home bets: EV_house = avgAmount × (1 - pH × oHome) = avgAmount × (1 - 1/1.10) ≈ avgAmount × 0.0909
      const evHome = nHome * avgAmount * (1 - pH * oHome)
      const evAway = nAway * avgAmount * (1 - pA * oAway)
      const evDraw = nDraw * avgAmount * (1 - pD * oDraw)
      const expectedPnl = evHome + evAway + evDraw
      const expectedMargin = volume > 0 ? expectedPnl / volume : 0

      // Scenario: home wins
      const homeWins = nHome * avgAmount * -(oHome - 1) + nAway * avgAmount + nDraw * avgAmount
      // Scenario: away wins
      const awayWins = nHome * avgAmount + nAway * avgAmount * -(oAway - 1) + nDraw * avgAmount
      // Scenario: draw
      const drawResult = pD > 0
        ? nHome * avgAmount + nAway * avgAmount + nDraw * avgAmount * -(oDraw - 1)
        : null

      const worstCase = Math.min(homeWins, awayWins, drawResult ?? Infinity)
      const bestCase = Math.max(homeWins, awayWins, drawResult ?? -Infinity)

      return {
        event_id: ev.id,
        sport: ev.sport,
        league: ev.league,
        match: `${ev.home_team} vs ${ev.away_team}`,
        start_time: ev.start_time,
        predictions: { home: pct.home, away: pct.away, draw: pct.draw ?? null },
        odds: {
          home: parseFloat(oHome.toFixed(2)),
          away: parseFloat(oAway.toFixed(2)),
          draw: pD > 0 ? parseFloat(oDraw.toFixed(2)) : null,
        },
        bets: { total: betsPerEvent, home: nHome, away: nAway, draw: nDraw },
        volume: parseFloat(volume.toFixed(2)),
        expected_pnl: parseFloat(expectedPnl.toFixed(2)),
        expected_margin_pct: parseFloat((expectedMargin * 100).toFixed(2)),
        scenarios: {
          home_wins: parseFloat(homeWins.toFixed(2)),
          away_wins: parseFloat(awayWins.toFixed(2)),
          draw: drawResult !== null ? parseFloat(drawResult.toFixed(2)) : null,
        },
        worst_case: parseFloat(worstCase.toFixed(2)),
        best_case: parseFloat(bestCase.toFixed(2)),
      }
    })

  const totalVolume = results.reduce((s, r) => s + r.volume, 0)
  const totalExpectedPnl = results.reduce((s, r) => s + r.expected_pnl, 0)
  const totalWorstCase = results.reduce((s, r) => s + r.worst_case, 0)
  const totalBestCase = results.reduce((s, r) => s + r.best_case, 0)

  return NextResponse.json({
    params: { bets_per_event: betsPerEvent, avg_amount: avgAmount },
    events: results,
    summary: {
      events_count: results.length,
      total_volume: parseFloat(totalVolume.toFixed(2)),
      expected_pnl: parseFloat(totalExpectedPnl.toFixed(2)),
      expected_margin_pct: totalVolume > 0 ? parseFloat((totalExpectedPnl / totalVolume * 100).toFixed(2)) : 0,
      worst_case: parseFloat(totalWorstCase.toFixed(2)),
      best_case: parseFloat(totalBestCase.toFixed(2)),
    },
  })
}
