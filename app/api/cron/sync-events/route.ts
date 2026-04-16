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
      const { data: inserted, error } = await supabase.from("events").insert(batch).select("id")
      if (error) {
        summary[sport.id].errors.push(`insert: ${error.message}`)
      } else {
        summary[sport.id].inserted += (inserted || []).length
      }
    }
  }

  const totalInserted = Object.values(summary).reduce((acc, s) => acc + s.inserted, 0)
  console.log("[cron/sync-events]", summary)

  return NextResponse.json({ success: true, totalInserted, summary })
}
