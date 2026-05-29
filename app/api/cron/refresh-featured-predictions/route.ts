import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { generateAiPredictions } from "@/lib/ai-predictions"

const CRON_SECRET = process.env.CRON_SECRET
const API_KEY = process.env.API_FOOTBALL_KEY
const FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"

function fetchApiSports(url: string): Promise<any> {
  if (!API_KEY) return Promise.reject(new Error("API_FOOTBALL_KEY not set"))
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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()

  const { data: featured, error } = await supabase
    .from("events")
    .select("id, external_id, sport, league, home_team, away_team, metadata")
    .eq("featured", true)
    .in("status", ["scheduled", "live"])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!featured?.length) return NextResponse.json({ success: true, fetched: 0, total: 0 })

  let fetched = 0
  const errors: string[] = []

  // Football: always refresh from api-sports.io
  if (API_KEY && FOOTBALL_URL) {
    const footballEvents = featured.filter(e => (e as any).sport === "football" && e.external_id?.startsWith("football_"))
    for (const ev of footballEvents) {
      const fixtureId = ev.external_id!.replace("football_", "")
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
        await supabase.from("events").update({ metadata: { ...(ev.metadata || {}), predictions } }).eq("id", ev.id)
        fetched++
      } catch (e: any) {
        errors.push(`${ev.external_id}: ${e.message}`)
      }
    }
  }

  // Non-football (basketball, baseball) or football without API predictions: use AI
  const needsAi = featured.filter(e => !(e as any).metadata?.predictions?.percent || (e as any).sport !== "football")
    .filter(e => !(e as any).metadata?.predictions?.percent)
  if (needsAi.length > 0) {
    try {
      const aiPreds = await generateAiPredictions(needsAi as any)
      for (const [eventId, prediction] of aiPreds) {
        const ev = featured.find((e: any) => e.id === eventId)
        await supabase.from("events").update({ metadata: { ...((ev as any)?.metadata || {}), predictions: prediction } }).eq("id", eventId)
        fetched++
      }
    } catch (e: any) {
      errors.push(`AI predictions: ${e.message}`)
    }
  }

  console.log("[cron/refresh-featured-predictions]", { fetched, total: featured.length, errors })

  return NextResponse.json({ success: true, fetched, total: featured.length, errors })
}
