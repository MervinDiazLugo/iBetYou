import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { generateAiPredictions } from "@/lib/ai-predictions"

const FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const API_KEY = process.env.API_FOOTBALL_KEY

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
    req.setTimeout(8000, () => { req.destroy(new Error("timeout")) })
    req.on("error", reject)
    req.end()
  })
}

// Public endpoint — no auth required. Only generates predictions; never exposes sensitive data.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const eventId = Number(id)
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()

  const { data: ev, error: evErr } = await supabase
    .from("events")
    .select("id, external_id, sport, league, home_team, away_team, metadata, featured")
    .eq("id", eventId)
    .single()

  if (evErr || !ev) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 })
  }

  // Return cached predictions if already present
  const existing = (ev.metadata as any)?.predictions?.percent
  if (existing) {
    return NextResponse.json({ predictions: (ev.metadata as any).predictions, cached: true })
  }

  let predictions: Record<string, unknown> | null = null

  // Football: try api-sports.io
  if (ev.sport === "football" && ev.external_id?.startsWith("football_") && API_KEY && FOOTBALL_URL) {
    const fixtureId = ev.external_id.replace("football_", "")
    try {
      const data = await fetchApiSports(`${FOOTBALL_URL}/predictions?fixture=${fixtureId}`)
      const raw = data.response?.[0]
      if (raw) {
        const pred = raw.predictions
        const home = raw.teams?.home
        const away = raw.teams?.away
        predictions = {
          percent: pred?.percent ?? null,
          advice: pred?.advice ?? null,
          winner: pred?.winner?.name ?? null,
          home_form: home?.last_5?.form ?? null,
          away_form: away?.last_5?.form ?? null,
          home_goals_avg: home?.last_5?.goals?.for?.average ?? null,
          away_goals_avg: away?.last_5?.goals?.for?.average ?? null,
          home_league_form: home?.league?.form ?? null,
          away_league_form: away?.league?.form ?? null,
        }
        if (!(predictions as any).percent) predictions = null
      }
    } catch (_) {}
  }

  // Fallback: AI predictions for any sport
  if (!predictions) {
    try {
      const aiMap = await generateAiPredictions([ev as any])
      const aiPred = aiMap.get(eventId)
      if (aiPred) predictions = aiPred as unknown as Record<string, unknown>
    } catch (_) {}
  }

  if (!predictions) {
    return NextResponse.json({ error: "No se pudieron generar predicciones para este evento" }, { status: 422 })
  }

  // Persist to DB
  await supabase
    .from("events")
    .update({ metadata: { ...((ev.metadata as any) || {}), predictions } })
    .eq("id", eventId)

  return NextResponse.json({ predictions, cached: false })
}
