import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"

const CRON_SECRET = process.env.CRON_SECRET
const API_KEY = process.env.API_FOOTBALL_KEY!
const FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const BASKETBALL_URL = process.env.API_BASKETBALL_URL || "https://v1.basketball.api-sports.io"
const BASEBALL_URL = process.env.API_BASEBALL_URL || "https://v1.baseball.api-sports.io"

const SPORT_CONFIG: Record<string, { baseUrl: string; endpoint: string }> = {
  football: { baseUrl: FOOTBALL_URL, endpoint: "fixtures" },
  basketball: { baseUrl: BASKETBALL_URL, endpoint: "games" },
  baseball: { baseUrl: BASEBALL_URL, endpoint: "games" },
}

// Window: only process events that started between 2h and 8h ago
const WINDOW_MIN_MS = 2 * 60 * 60 * 1000
const WINDOW_MAX_MS = 8 * 60 * 60 * 1000

function fetchApiSports(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const { hostname, pathname, search } = new URL(url)
    const req = https.request(
      { method: "GET", hostname, path: pathname + search, headers: { "x-apisports-key": API_KEY } },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
          catch (e) { reject(e) }
        })
      }
    )
    req.setTimeout(10000, () => { req.destroy(new Error("timeout")) })
    req.on("error", reject)
    req.end()
  })
}

function mapStatus(short?: string): string {
  if (!short) return "scheduled"
  if (["FT", "AOT", "FIN"].includes(short)) return "finished"
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "Q1", "Q2", "Q3", "Q4", "OT"].includes(short)) return "live"
  return "scheduled"
}

interface ScoreData {
  externalId: string
  status: string
  homeScore: number | null
  awayScore: number | null
  halftimeHome?: number | null
  halftimeAway?: number | null
}

function parseScore(sport: string, item: any): ScoreData | null {
  if (sport === "football") {
    if (!item.fixture?.id) return null
    return {
      externalId: `football_${item.fixture.id}`,
      status: mapStatus(item.fixture?.status?.short),
      homeScore: item.goals?.home ?? null,
      awayScore: item.goals?.away ?? null,
      halftimeHome: item.score?.halftime?.home ?? null,
      halftimeAway: item.score?.halftime?.away ?? null,
    }
  }
  if (sport === "basketball") {
    if (!item.id) return null
    return {
      externalId: `basketball_${item.id}`,
      status: mapStatus(item.status?.short),
      homeScore: item.scores?.home?.total ?? null,
      awayScore: item.scores?.away?.total ?? null,
    }
  }
  if (sport === "baseball") {
    if (!item.id) return null
    return {
      externalId: `baseball_${item.id}`,
      status: mapStatus(item.status?.short),
      homeScore: item.scores?.home?.total ?? null,
      awayScore: item.scores?.away?.total ?? null,
    }
  }
  return null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!API_KEY) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 })
  }

  const supabase = createAdminSupabaseClient()
  const now = Date.now()
  const windowStart = new Date(now - WINDOW_MAX_MS).toISOString()
  const windowEnd = new Date(now - WINDOW_MIN_MS).toISOString()

  // 1. Find events with active bets in the 2h–8h window, not yet finished in DB
  const { data: activeBets, error: betsError } = await supabase
    .from("bets")
    .select(`
      bet_type,
      event:events!event_id(id, external_id, sport, start_time, status, metadata)
    `)
    .in("status", ["taken", "disputed"])

  if (betsError) return NextResponse.json({ error: betsError.message }, { status: 500 })

  // Deduplicate events, track if any bet is first_scorer type
  const eventMap = new Map<number, {
    id: number
    external_id: string
    sport: string
    start_time: string
    status: string
    metadata: any
    hasFirstScorer: boolean
  }>()

  for (const bet of activeBets || []) {
    const event = Array.isArray((bet as any).event) ? (bet as any).event[0] : (bet as any).event
    if (!event || event.status === "finished") continue

    const startMs = new Date(event.start_time).getTime()
    if (startMs + WINDOW_MIN_MS > now) continue  // less than 2h since start
    if (startMs + WINDOW_MAX_MS < now) continue  // more than 8h since start

    const existing = eventMap.get(event.id)
    eventMap.set(event.id, {
      ...event,
      hasFirstScorer: existing?.hasFirstScorer || (bet as any).bet_type === "first_scorer",
    })
  }

  if (eventMap.size === 0) {
    return NextResponse.json({ success: true, message: "No events in sync window", apiCalls: 0 })
  }

  // 2. Group by sport + date (one API call per combination)
  const sportDateMap = new Map<string, Set<string>>()
  for (const event of eventMap.values()) {
    const date = new Date(event.start_time).toISOString().split("T")[0]
    if (!sportDateMap.has(event.sport)) sportDateMap.set(event.sport, new Set())
    sportDateMap.get(event.sport)!.add(date)
  }

  // 3. Fetch scores from api-sports.io
  const scoresByExternalId = new Map<string, ScoreData>()
  let apiCalls = 0
  const apiErrors: string[] = []

  for (const [sport, dates] of sportDateMap) {
    const config = SPORT_CONFIG[sport]
    if (!config) continue

    for (const date of dates) {
      try {
        const data = await fetchApiSports(`${config.baseUrl}/${config.endpoint}?date=${date}`)
        apiCalls++
        if (!data.response || !Array.isArray(data.response)) continue

        for (const item of data.response) {
          const score = parseScore(sport, item)
          if (score) scoresByExternalId.set(score.externalId, score)
        }
      } catch (e: any) {
        apiErrors.push(`${sport}/${date}: ${e.message}`)
      }
    }
  }

  // 4. Update events in DB
  const justFinished: Array<{ id: number; hasFirstScorer: boolean; externalId: string }> = []
  let updated = 0

  for (const event of eventMap.values()) {
    const score = scoresByExternalId.get(event.external_id)
    if (!score) continue

    const metadata = event.metadata || {}
    const matchDetails = { ...(metadata.match_details || {}) }

    if (score.halftimeHome !== null && score.halftimeHome !== undefined) {
      matchDetails.halftime_home_score = score.halftimeHome
      matchDetails.halftime_away_score = score.halftimeAway
    }

    await supabase
      .from("events")
      .update({
        status: score.status,
        home_score: score.homeScore,
        away_score: score.awayScore,
        metadata: { ...metadata, match_details: matchDetails },
      })
      .eq("id", event.id)

    updated++

    if (score.status === "finished") {
      justFinished.push({ id: event.id, hasFirstScorer: event.hasFirstScorer, externalId: event.external_id })
    }
  }

  // 5. Fetch first_scorer data for finished football events that need it
  for (const ev of justFinished) {
    if (!ev.hasFirstScorer || !ev.externalId.startsWith("football_")) continue

    const fixtureId = ev.externalId.replace("football_", "")
    try {
      const data = await fetchApiSports(`${FOOTBALL_URL}/fixtures/events?fixture=${fixtureId}`)
      apiCalls++

      const fixtureEvents: any[] = data.response || []
      const firstGoal = fixtureEvents.find(
        (e: any) => e.type === "Goal" && e.detail !== "Missed Penalty"
      )

      if (firstGoal) {
        const { data: eventRow } = await supabase
          .from("events")
          .select("metadata")
          .eq("id", ev.id)
          .single()

        const md = eventRow?.metadata || {}
        const matchDetails = { ...(md.match_details || {}) }
        matchDetails.first_scorer = {
          player: firstGoal.player?.name || null,
          team: firstGoal.team?.name || null,
          minute: firstGoal.time?.elapsed ?? null,
        }

        await supabase
          .from("events")
          .update({ metadata: { ...md, match_details: matchDetails } })
          .eq("id", ev.id)
      }
    } catch (e: any) {
      apiErrors.push(`first_scorer/${ev.externalId}: ${e.message}`)
    }
  }

  // 6. Trigger auto-resolve for each event that just became finished
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")

  const resolvedEvents: number[] = []
  for (const ev of justFinished) {
    try {
      const res = await fetch(`${baseUrl}/api/admin/bets/auto-resolve-finished`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({ event_id: ev.id }),
      })
      if (res.ok) resolvedEvents.push(ev.id)
      else apiErrors.push(`auto-resolve/event_${ev.id}: HTTP ${res.status}`)
    } catch (e: any) {
      apiErrors.push(`auto-resolve/event_${ev.id}: ${e.message}`)
    }
  }

  console.log("[cron/sync-scores]", { updated, justFinished: justFinished.length, resolvedEvents, apiCalls, apiErrors })

  return NextResponse.json({
    success: true,
    eventsInWindow: eventMap.size,
    updated,
    justFinished: justFinished.length,
    resolvedEvents,
    apiCalls,
    errors: apiErrors,
  })
}
