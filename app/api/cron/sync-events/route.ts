import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"

const CRON_SECRET = process.env.CRON_SECRET
const API_KEY = process.env.API_FOOTBALL_KEY!
const FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const BASKETBALL_URL = process.env.API_BASKETBALL_URL || "https://v1.basketball.api-sports.io"
const BASEBALL_URL = process.env.API_BASEBALL_URL || "https://v1.baseball.api-sports.io"

const SPORTS = [
  { id: "football", baseUrl: FOOTBALL_URL, endpoint: "fixtures" },
  { id: "basketball", baseUrl: BASKETBALL_URL, endpoint: "games" },
  { id: "baseball", baseUrl: BASEBALL_URL, endpoint: "games" },
]

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

function normalizeEvent(sport: string, event: any): Record<string, unknown> | null {
  if (sport === "football") {
    if (!event.fixture?.id || !event.teams?.home?.name || !event.teams?.away?.name) return null
    return {
      external_id: `football_${event.fixture.id}`,
      sport: "football",
      league: event.league?.name || "Unknown",
      country: event.league?.country || "Unknown",
      home_team: event.teams.home.name,
      away_team: event.teams.away.name,
      home_logo: event.teams.home.logo || null,
      away_logo: event.teams.away.logo || null,
      start_time: event.fixture.date,
      status: mapStatus(event.fixture.status?.short),
      metadata: { venue: { name: event.fixture.venue?.name || null, city: event.fixture.venue?.city || null } },
    }
  }
  if (sport === "basketball") {
    if (!event.id || !event.teams?.home?.name || !event.teams?.away?.name) return null
    return {
      external_id: `basketball_${event.id}`,
      sport: "basketball",
      league: event.league?.name || "Unknown",
      country: event.country?.name || "Unknown",
      home_team: event.teams.home.name,
      away_team: event.teams.away.name,
      home_logo: event.teams.home.logo || null,
      away_logo: event.teams.away.logo || null,
      start_time: event.date,
      status: mapStatus(event.status?.short),
      metadata: { venue: { name: event.venue || null, city: null } },
    }
  }
  if (sport === "baseball") {
    if (!event.id || !event.teams?.home?.name || !event.teams?.away?.name) return null
    return {
      external_id: `baseball_${event.id}`,
      sport: "baseball",
      league: event.league?.name || "Unknown",
      country: event.country?.name || "Unknown",
      home_team: event.teams.home.name,
      away_team: event.teams.away.name,
      home_logo: event.teams.home.logo || null,
      away_logo: event.teams.away.logo || null,
      start_time: event.date,
      status: mapStatus(event.status?.short),
      metadata: { venue: { name: event.venue?.name || null, city: event.venue?.city || null } },
    }
  }
  return null
}

// Next N days as YYYY-MM-DD strings (UTC)
function getDateRange(days: number): string[] {
  const dates: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + i)
    dates.push(d.toISOString().split("T")[0])
  }
  return dates
}

const BATCH_SIZE = 500
const MAX_PREDICTIONS = 20

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!API_KEY) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 })
  }

  const supabase = createAdminSupabaseClient()
  const dates = getDateRange(7)
  const summary: Record<string, { inserted: number; skipped: number; errors: string[] }> = {}

  // Collect newly inserted football events for prediction enrichment
  const newFootballEvents: Array<{ id: number; external_id: string }> = []

  for (const sport of SPORTS) {
    summary[sport.id] = { inserted: 0, skipped: 0, errors: [] }
    const allEvents: Record<string, unknown>[] = []

    for (const date of dates) {
      try {
        const data = await fetchApiSports(`${sport.baseUrl}/${sport.endpoint}?date=${date}`)
        if (!data.response || !Array.isArray(data.response)) continue

        for (const raw of data.response) {
          const normalized = normalizeEvent(sport.id, raw)
          if (normalized) allEvents.push(normalized)
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "unknown"
        summary[sport.id].errors.push(`${date}: ${msg}`)
      }
    }

    if (allEvents.length === 0) continue

    // Find which external_ids already exist
    const externalIds = allEvents.map((e) => e.external_id as string)
    const { data: existing } = await supabase
      .from("events")
      .select("external_id")
      .in("external_id", externalIds)

    const existingSet = new Set((existing || []).map((e: any) => e.external_id as string))
    const toInsert = allEvents.filter((e) => !existingSet.has(e.external_id as string))
    summary[sport.id].skipped = allEvents.length - toInsert.length

    // Batch insert new events
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE)
      const { data: inserted, error } = await supabase.from("events").insert(batch).select("id, external_id")
      if (error) {
        summary[sport.id].errors.push(`insert: ${error.message}`)
      } else {
        summary[sport.id].inserted += (inserted || []).length
        if (sport.id === "football" && inserted) {
          newFootballEvents.push(...(inserted as Array<{ id: number; external_id: string }>))
        }
      }
    }
  }

  // Fetch predictions for new football events (up to MAX_PREDICTIONS)
  let predictionsFetched = 0
  const predictionErrors: string[] = []
  const toEnrich = newFootballEvents.slice(0, MAX_PREDICTIONS)

  for (const ev of toEnrich) {
    const fixtureId = ev.external_id.replace("football_", "")
    try {
      const data = await fetchApiSports(`${FOOTBALL_URL}/predictions?fixture=${fixtureId}`)
      const raw = data.response?.[0]
      if (!raw) continue

      const pred = raw.predictions
      const home = raw.teams?.home
      const away = raw.teams?.away

      const predictions = {
        percent: pred?.percent ?? null,
        advice: pred?.advice ?? null,
        winner: pred?.winner?.name ?? null,
        home_form: home?.last_5?.form ?? null,
        away_form: away?.last_5?.form ?? null,
        home_goals_avg: home?.last_5?.goals?.for?.average ?? null,
        away_goals_avg: away?.last_5?.goals?.for?.average ?? null,
        home_league_form: home?.league?.form ?? null,
        away_league_form: away?.league?.form ?? null,
        comparison: raw.comparison ?? null,
        h2h: (raw.h2h ?? []).slice(0, 5).map((m: any) => ({
          date: m.fixture?.date?.split("T")[0] ?? null,
          home: m.teams?.home?.name ?? null,
          away: m.teams?.away?.name ?? null,
          home_score: m.goals?.home ?? null,
          away_score: m.goals?.away ?? null,
        })),
      }

      const { data: evRow } = await supabase.from("events").select("metadata").eq("id", ev.id).single()
      await supabase.from("events")
        .update({ metadata: { ...(evRow?.metadata || {}), predictions } })
        .eq("id", ev.id)

      predictionsFetched++
    } catch (e: any) {
      predictionErrors.push(`${ev.external_id}: ${e.message}`)
    }
  }

  const totalInserted = Object.values(summary).reduce((acc, s) => acc + s.inserted, 0)
  console.log("[cron/sync-events]", { summary, predictionsFetched, predictionErrors })

  return NextResponse.json({ success: true, totalInserted, summary, predictionsFetched, predictionErrors })
}
