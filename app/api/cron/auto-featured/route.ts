import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { generateAiPredictions } from "@/lib/ai-predictions"

const CRON_SECRET = process.env.CRON_SECRET
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY
const FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const MAX_FEATURED = 18
const LOOKAHEAD_DAYS = 4

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

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
  }

  const supabase = createAdminSupabaseClient()
  const now = new Date()
  const cutoff = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)

  const { data: events, error } = await supabase
    .from("events")
    .select("id, external_id, sport, league, country, home_team, away_team, start_time, status, metadata")
    .in("status", ["scheduled", "live"])
    .gte("start_time", now.toISOString())
    .lte("start_time", cutoff.toISOString())
    .order("start_time", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!events || events.length < 3) {
    return NextResponse.json({ success: true, message: "Not enough upcoming events to curate", featured: [] })
  }

  const footballCount = events.filter(e => e.sport === "football").length
  const basketballCount = events.filter(e => e.sport === "basketball").length
  const baseballCount = events.filter(e => e.sport === "baseball").length

  // Compact format: id|sport|league|home vs away|date — ~50% fewer tokens than JSON
  const eventLines = events
    .map(e => `${e.id}|${e.sport}|${e.league}|${e.home_team} vs ${e.away_team}|${e.start_time.slice(0, 16).replace("T", " ")}`)
    .join("\n")

  const prompt = `Curate ${MAX_FEATURED} featured events for iBetYou (Venezuelan P2P betting).

CAPS: football 6-10, basketball 1-5, baseball 0-5. Total=${MAX_FEATURED}.
Available: ${footballCount} football, ${basketballCount} basketball, ${baseballCount} baseball.

PRIORITIES (in order):
1. UEFA CL/EL, Copa Libertadores/Sudamericana, CONMEBOL WC qualifiers
2. Top clubs: Real Madrid, Barcelona, Man City, Liverpool, PSG, Bayern
3. Premier League, La Liga, Bundesliga, Serie A, Ligue 1
4. NBA Playoffs/Finals, then 1-5 MLB games

Events (id|sport|league|match|UTC):
${eventLines}

Reply ONLY with a JSON array of ${MAX_FEATURED} IDs: [123,456,...]`

  let selectedIds: number[] = []

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return NextResponse.json({ error: `Claude API error: ${res.status} ${body}` }, { status: 500 })
    }

    const data = await res.json()
    const text: string = data?.content?.[0]?.text ?? ""

    const match = text.match(/\[[\d,\s]+\]/)
    if (!match) {
      return NextResponse.json({ error: "Claude returned unparseable response", raw: text }, { status: 500 })
    }

    const parsed: unknown = JSON.parse(match[0])
    if (!Array.isArray(parsed)) throw new Error("Not an array")

    const validIds = new Set(events.map(e => e.id))
    const rawIds = (parsed as unknown[])
      .map(v => Number(v))
      .filter(id => Number.isFinite(id) && validIds.has(id))

    // Enforce sport caps regardless of what Claude returns
    const eventMap = new Map(events.map(e => [e.id, e]))
    const football = rawIds.filter(id => eventMap.get(id)?.sport === "football").slice(0, 10)
    const basketball = rawIds.filter(id => eventMap.get(id)?.sport === "basketball").slice(0, 5)
    const baseball = rawIds.filter(id => eventMap.get(id)?.sport === "baseball").slice(0, 5)
    let enforcedIds = [...football, ...basketball, ...baseball]

    // If under MAX_FEATURED, fill with football events not already selected
    if (enforcedIds.length < MAX_FEATURED) {
      const included = new Set(enforcedIds)
      const extra = events
        .filter(e => e.sport === "football" && !included.has(e.id))
        .slice(0, MAX_FEATURED - enforcedIds.length)
        .map(e => e.id)
      enforcedIds = [...enforcedIds, ...extra]
    }

    selectedIds = enforcedIds.slice(0, MAX_FEATURED)
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to parse Claude response: ${e.message}` }, { status: 500 })
  }

  // Generate predictions FIRST — only events with confirmed predictions get marked featured
  const selectedEvents = events.filter(e => selectedIds.includes(e.id))
  const eventsWithPredictions = new Set<number>()
  const predictionErrors: string[] = []

  // Events that already have predictions from a previous cron run
  selectedEvents.forEach(ev => {
    if ((ev.metadata as any)?.predictions?.percent) eventsWithPredictions.add(ev.id)
  })

  // Football: try api-sports first
  const footballEvents = selectedEvents.filter(e => e.sport === "football" && e.external_id?.startsWith("football_"))
  const footballWithApi = new Set<number>()

  const footballResults = await Promise.all(footballEvents.map(async (ev) => {
    const fixtureId = ev.external_id.replace("football_", "")
    try {
      const data = await fetchApiSports(`${FOOTBALL_URL}/predictions?fixture=${fixtureId}`)
      const raw = data.response?.[0]
      if (!raw) return false

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

      if (!predictions.percent) return false

      const existingMd = ev.metadata || {}
      await supabase.from("events")
        .update({ metadata: { ...existingMd, predictions } })
        .eq("id", ev.id)

      footballWithApi.add(ev.id)
      eventsWithPredictions.add(ev.id)
      return true
    } catch (e: any) {
      predictionErrors.push(`${ev.external_id}: ${e.message}`)
      return false
    }
  }))
  const predictionsFetched = footballResults.filter(Boolean).length

  // AI predictions for: non-football + football events that failed api-sports
  const needsAi = selectedEvents.filter(e => !footballWithApi.has(e.id) && !eventsWithPredictions.has(e.id))
  const aiPredictions = await generateAiPredictions(needsAi)
  const aiPredictionsFetched = aiPredictions.size

  await Promise.all(Array.from(aiPredictions.entries()).map(async ([eventId, prediction]) => {
    const ev = selectedEvents.find(e => e.id === eventId)
    const existingMd = (ev?.metadata as any) || {}
    await supabase.from("events")
      .update({ metadata: { ...existingMd, predictions: prediction } })
      .eq("id", eventId)
    eventsWithPredictions.add(eventId)
  }))

  // Only mark as featured events that have confirmed predictions
  const confirmedIds = selectedIds.filter(id => eventsWithPredictions.has(id))

  const { error: clearErr } = await supabase
    .from("events")
    .update({ featured: false })
    .eq("featured", true)

  if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 })

  if (confirmedIds.length > 0) {
    const { error: setErr } = await supabase
      .from("events")
      .update({ featured: true })
      .in("id", confirmedIds)

    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })
  }

  const skipped = selectedIds.filter(id => !eventsWithPredictions.has(id))
  console.log("[cron/auto-featured]", { total: events.length, confirmed: confirmedIds.length, skipped: skipped.length, predictionsFetched, aiPredictionsFetched, predictionErrors })

  return NextResponse.json({ success: true, total: events.length, featured: confirmedIds, skipped, predictionsFetched, aiPredictionsFetched, predictionErrors })
}
