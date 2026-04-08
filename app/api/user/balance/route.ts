import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

type BetRow = {
  id: string
  creator_id: string
  acceptor_id: string | null
  event_id: number
  amount: number
  multiplier: number
  bet_type: string
  fee_amount: number
  status: string
  winner_id: string | null
  creator_selection: string
  acceptor_selection: string | null
  created_at: string
  resolved_at?: string | null
  event: {
    id: number
    sport: string
    home_team: string
    away_team: string
    league: string
    start_time: string
  } | null
}

function calculateBetNetForUser(bet: BetRow, userId: string) {
  const isCreator = bet.creator_id === userId
  const isExactScore = bet.bet_type === "exact_score"

  const stake = isCreator ? Number(bet.amount) : Number(isExactScore ? bet.amount * bet.multiplier : bet.amount)
  const fee = isCreator ? Number(bet.fee_amount || 0) : Number(stake * 0.03)
  const totalRisk = stake + fee

  if (bet.status !== "resolved" || !bet.winner_id) {
    return {
      result: "pending" as const,
      netAmount: 0,
      stake,
      fee,
    }
  }

  const userWon = bet.winner_id === userId
  const grossGain = isCreator ? Number(bet.amount * bet.multiplier) : Number(bet.amount)

  return {
    result: userWon ? ("won" as const) : ("lost" as const),
    netAmount: userWon ? grossGain - fee : -totalRisk,
    stake,
    fee,
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminSupabaseClient()

    const { data, error } = await supabase
      .from("bets")
      .select(`
        id,
        creator_id,
        acceptor_id,
        event_id,
        amount,
        multiplier,
        bet_type,
        fee_amount,
        status,
        winner_id,
        creator_selection,
        acceptor_selection,
        created_at,
        resolved_at,
        event:events(id, sport, home_team, away_team, league, start_time)
      `)
      .or(`creator_id.eq.${userId},acceptor_id.eq.${userId}`)
      .in("status", ["resolved", "taken", "pending_resolution", "disputed", "cancelled", "open"])
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const bets = (data || []) as unknown as BetRow[]

    const rows = bets.map((bet) => {
      const isCreator = bet.creator_id === userId
      const metrics = calculateBetNetForUser(bet, userId)

      const eventTitle = bet.event
        ? `${bet.event.home_team} vs ${bet.event.away_team}`
        : `Evento ${bet.event_id}`

      const userSelection = isCreator
        ? bet.creator_selection
        : (bet.acceptor_selection || `Contra: ${bet.creator_selection}`)

      return {
        bet_id: bet.id,
        event_id: bet.event_id,
        event_title: eventTitle,
        league: bet.event?.league || "",
        sport: bet.event?.sport || "",
        selection: userSelection,
        result: metrics.result,
        net_amount: Number(metrics.netAmount.toFixed(2)),
        stake: Number(metrics.stake.toFixed(2)),
        fee: Number(metrics.fee.toFixed(2)),
        created_at: bet.created_at,
        resolved_at: bet.resolved_at || null,
      }
    })

    const resolvedRows = rows.filter((row) => row.result === "won" || row.result === "lost")
    const totalNet = resolvedRows.reduce((acc, row) => acc + row.net_amount, 0)
    const wonCount = resolvedRows.filter((row) => row.result === "won").length
    const lostCount = resolvedRows.filter((row) => row.result === "lost").length

    return NextResponse.json({
      summary: {
        total_bets: rows.length,
        resolved_bets: resolvedRows.length,
        won_bets: wonCount,
        lost_bets: lostCount,
        total_net: Number(totalNet.toFixed(2)),
      },
      bets: rows,
    })
  } catch (error) {
    console.error("Get user balance error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
