import { NextRequest, NextResponse } from "next/server"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createAdminSupabaseClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  const { data: bets, error } = await supabase
    .from("bets")
    .select(`
      id, event_id, creator_selection, amount, multiplier, status, winner_id, creator_id,
      event:events(id, home_team, away_team, sport, league, home_score, away_score, status)
    `)
    .eq("is_simulation", true)
    .order("event_id", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!bets?.length) return NextResponse.json({ bets: [], summary: null })

  const pending = bets.filter(b => b.status === "taken")
  const resolved = bets.filter(b => b.status === "resolved")
  const cancelled = bets.filter(b => b.status === "cancelled")

  // For resolved bets: house wins if winner_id is null (house_bet with no acceptor → house side wins)
  // House wins when user's selection was WRONG (user_selection != actual_result)
  // winner_id = null means house won (no user to credit), winner_id = creator_id means user won
  let houseWins = 0
  let houseLosses = 0
  let houseRevenue = 0  // collected from losing bets
  let housePayout = 0   // paid out on winning bets
  let fees = 0

  const byEvent: Record<number, {
    event: any
    total: number
    won: number
    lost: number
    revenue: number
    payout: number
    pnl: number
  }> = {}

  for (const bet of resolved) {
    const amount = Number(bet.amount)
    const ev = bet.event as any
    const eventId = Number(bet.event_id)

    if (!byEvent[eventId]) {
      byEvent[eventId] = { event: ev, total: 0, won: 0, lost: 0, revenue: 0, payout: 0, pnl: 0 }
    }

    byEvent[eventId].total++
    fees += Number(bet.amount) * 0.03

    // winner_id === null → house won (user lost)
    // winner_id === creator_id → user won (house lost)
    const houseWon = bet.winner_id === null

    if (houseWon) {
      houseWins++
      houseRevenue += amount
      byEvent[eventId].won++
      byEvent[eventId].revenue += amount
    } else {
      houseLosses++
      // House pays potential_payout — approximated as amount × multiplier + amount
      const payout = amount * Number(bet.multiplier) + amount
      housePayout += payout
      byEvent[eventId].lost++
      byEvent[eventId].payout += payout
    }
  }

  const housePnl = houseRevenue - housePayout

  // Build per-event summary
  const eventSummary = Object.values(byEvent).map(e => ({
    event_id: (e.event as any)?.id,
    match: `${(e.event as any)?.home_team} vs ${(e.event as any)?.away_team}`,
    sport: (e.event as any)?.sport,
    result: (e.event as any)?.home_score !== null
      ? `${(e.event as any)?.home_score}-${(e.event as any)?.away_score}`
      : null,
    bets: e.total,
    house_won: e.won,
    house_lost: e.lost,
    revenue: parseFloat(e.revenue.toFixed(2)),
    payout: parseFloat(e.payout.toFixed(2)),
    pnl: parseFloat((e.revenue - e.payout).toFixed(2)),
    win_rate: e.total > 0 ? parseFloat((e.won / e.total * 100).toFixed(1)) : 0,
  }))

  return NextResponse.json({
    status: {
      pending: pending.length,
      resolved: resolved.length,
      cancelled: cancelled.length,
      total: bets.length,
    },
    summary: resolved.length === 0 ? null : {
      house_wins: houseWins,
      house_losses: houseLosses,
      win_rate_pct: resolved.length > 0 ? parseFloat((houseWins / resolved.length * 100).toFixed(1)) : 0,
      total_revenue: parseFloat(houseRevenue.toFixed(2)),
      total_payout: parseFloat(housePayout.toFixed(2)),
      net_pnl: parseFloat(housePnl.toFixed(2)),
      total_volume: parseFloat(resolved.reduce((s, b) => s + Number(b.amount), 0).toFixed(2)),
      actual_margin_pct: (() => {
        const vol = resolved.reduce((s, b) => s + Number(b.amount), 0)
        return vol > 0 ? parseFloat((housePnl / vol * 100).toFixed(2)) : 0
      })(),
      fees_collected: parseFloat(fees.toFixed(2)),
    },
    by_event: eventSummary,
  })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const { error } = await supabase.from("bets").delete().eq("is_simulation", true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
