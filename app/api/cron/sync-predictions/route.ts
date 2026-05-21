import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"

const CRON_SECRET = process.env.CRON_SECRET
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY
const FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const MAX_FETCHES = 10

function fetchApiSports(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const { hostname, pathname, search } = new URL(url)
    const req = https.request(
      { method: "GET", hostname, path: pathname + search, headers: { "x-apisports-key": API_FOOTBALL_KEY! } },
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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const now = new Date()
  const cutoff = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  // Football events in next 3 days without predictions, prioritizing ones that have open bets
  const { data: events, error } = await supabase
    .from("events")
    .select("id, external_id, metadata")
    .eq("sport", "football")
    .eq("status", "scheduled")
    .gte("start_time", now.toISOString())
    .lte("start_time", cutoff.toISOString())
    .order("start_time", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!events?.length) return NextResponse.json({ success: true, fetched: 0 })

  // Skip events that already have predictions
  const needsPredictions = events.filter(e =>
    e.external_id?.startsWith("football_") &&
    !e.metadata?.predictions?.percent
  )

  // Get events that have open bets — fetch those first
  const eventIds = needsPredictions.map(e => e.id)
  const { data: betsData } = await supabase
    .from("bets")
    .select("event_id")
    .in("event_id", eventIds)
    .eq("status", "open")

  const eventIdsWithBets = new Set((betsData || []).map(b => b.event_id))

  const prioritized = [
    ...needsPredictions.filter(e => eventIdsWithBets.has(e.id)),
    ...needsPredictions.filter(e => !eventIdsWithBets.has(e.id)),
  ].slice(0, MAX_FETCHES)

  let fetched = 0
  const errors: string[] = []

  for (const ev of prioritized) {
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

      const existingMd = ev.metadata || {}
      await supabase.from("events")
        .update({ metadata: { ...existingMd, predictions } })
        .eq("id", ev.id)

      fetched++
    } catch (e: any) {
      errors.push(`${ev.external_id}: ${e.message}`)
    }
  }

  console.log("[cron/sync-predictions]", { fetched, errors, skipped: needsPredictions.length - prioritized.length })

  return NextResponse.json({ success: true, fetched, errors, remaining: needsPredictions.length - prioritized.length })
}
