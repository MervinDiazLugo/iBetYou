import { NextRequest, NextResponse } from "next/server"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createAdminSupabaseClient } from "@/lib/supabase"

const HOUSE_NICKNAME = "TheOne"

function parsePercent(val: string | undefined): number {
  if (!val) return 0
  return parseFloat(String(val).replace("%", "")) / 100
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const body = await request.json()
  const betsPerEvent = Math.min(200, Math.max(1, Number(body.bets_per_event ?? 30)))
  const minAmount = Math.max(1, Number(body.min_amount ?? 5))
  const maxAmount = Math.max(minAmount, Number(body.max_amount ?? 50))

  const supabase = createAdminSupabaseClient()

  // Get TheOne user ID (house)
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("nickname", HOUSE_NICKNAME)
    .single()

  if (!profile) return NextResponse.json({ error: `User "${HOUSE_NICKNAME}" not found` }, { status: 404 })
  const houseId = profile.id

  // Get featured events with predictions
  const { data: events, error } = await supabase
    .from("events")
    .select("id, sport, home_team, away_team, metadata")
    .eq("featured", true)
    .in("status", ["scheduled", "live"])
    .order("start_time", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const eligible = (events || []).filter(ev => (ev.metadata as any)?.predictions?.percent)
  if (!eligible.length) return NextResponse.json({ error: "No featured events with predictions" }, { status: 422 })

  // Delete previous simulation bets that are still open (clean slate)
  await supabase
    .from("bets")
    .delete()
    .eq("is_simulation", true)
    .eq("status", "taken")

  const created: Array<{ event_id: number; selection: string; amount: number }> = []
  const errors: string[] = []

  for (const ev of eligible) {
    const pred = (ev.metadata as any).predictions
    const pct = pred.percent

    const homeProb = parsePercent(pct.home)
    const awayProb = parsePercent(pct.away)
    const drawProb = pct.draw ? parsePercent(pct.draw) : 0
    const total = homeProb + awayProb + drawProb

    // Build weighted selection pool
    const pool: string[] = []
    const nHome = Math.round((homeProb / total) * betsPerEvent)
    const nAway = Math.round((awayProb / total) * betsPerEvent)
    const nDraw = betsPerEvent - nHome - nAway

    for (let i = 0; i < nHome; i++) pool.push("home")
    for (let i = 0; i < nAway; i++) pool.push("away")
    if (drawProb > 0) for (let i = 0; i < nDraw; i++) pool.push("draw")

    // Shuffle pool
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]]
    }

    for (const selection of pool) {
      const amount = randomBetween(minAmount, maxAmount)
      const feeAmount = parseFloat((amount * 0.03).toFixed(2))

      const selectionLabel =
        selection === "home" ? ev.home_team
        : selection === "away" ? ev.away_team
        : "Empate"

      const { data: bet, error: betErr } = await supabase
        .from("bets")
        .insert({
          event_id: ev.id,
          creator_id: houseId,
          bet_type: "direct",
          selection: JSON.stringify({ selection: selectionLabel }),
          creator_selection: selectionLabel,
          amount,
          multiplier: 1,
          fee_amount: feeAmount,
          status: "taken",
          house_bet: true,
          is_simulation: true,
          mode: "fantasy",
        })
        .select("id")
        .single()

      if (betErr) {
        errors.push(`event ${ev.id} ${selection}: ${betErr.message}`)
      } else {
        created.push({ event_id: ev.id, selection: selectionLabel, amount })
      }
    }
  }

  return NextResponse.json({
    success: true,
    created: created.length,
    events: eligible.length,
    errors,
  })
}
