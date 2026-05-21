import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"

const CRON_SECRET = process.env.CRON_SECRET
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY
const FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const MAX_FEATURED = 16
const LOOKAHEAD_DAYS = 3

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

  const eventList = events.map(e => ({
    id: e.id,
    sport: e.sport,
    league: e.league,
    country: e.country,
    match: `${e.home_team} vs ${e.away_team}`,
    start_time: e.start_time,
  }))

  const prompt = `You are curating featured events for iBetYou, a Venezuelan P2P sports betting platform.

Select the ${MAX_FEATURED} most compelling upcoming events for Venezuelan sports fans to bet on.

MANDATORY — always include if present, regardless of other criteria:
- FIFA World Cup (any stage)
- UEFA Champions League (any stage)
- UEFA Europa League knockout rounds
- Copa América
- Copa Libertadores (knockout rounds especially)
- Copa Sudamericana (knockout rounds especially)
- FIFA World Cup Qualifiers (CONMEBOL)
- NBA Playoffs / Finals
- MLB (regular season AND playoffs — always include at least one MLB game if available)

After mandatory events, fill remaining slots by prioritizing:
- Top domestic leagues: Premier League, La Liga, Bundesliga, Serie A, Ligue 1
- High-profile derbies and rivalry matches
- Matches involving top global clubs (Real Madrid, Barcelona, Manchester City, Liverpool, etc.)
- Variety across sports when available
- Cultural relevance: Venezuelan fans follow South American football closely

Upcoming events (next ${LOOKAHEAD_DAYS} days):
${JSON.stringify(eventList, null, 2)}

Respond with ONLY a JSON array of the selected event IDs. Example: [123, 456, 789]
No explanation. No markdown. Just the raw JSON array.`

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
    selectedIds = (parsed as unknown[])
      .map(v => Number(v))
      .filter(id => Number.isFinite(id) && validIds.has(id))
      .slice(0, MAX_FEATURED)
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to parse Claude response: ${e.message}` }, { status: 500 })
  }

  // Clear all current featured flags, then set the new ones
  const { error: clearErr } = await supabase
    .from("events")
    .update({ featured: false })
    .eq("featured", true)

  if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 })

  if (selectedIds.length > 0) {
    const { error: setErr } = await supabase
      .from("events")
      .update({ featured: true })
      .in("id", selectedIds)

    if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })
  }

  // Fetch predictions for featured football events and store in metadata
  const selectedEvents = events.filter(e => selectedIds.includes(e.id))
  const footballEvents = selectedEvents.filter(e => e.sport === "football" && e.external_id?.startsWith("football_"))
  let predictionsFetched = 0
  const predictionErrors: string[] = []

  for (const ev of footballEvents) {
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

      predictionsFetched++
    } catch (e: any) {
      predictionErrors.push(`${ev.external_id}: ${e.message}`)
    }
  }

  console.log("[cron/auto-featured]", { total: events.length, featured: selectedIds, predictionsFetched, predictionErrors })

  return NextResponse.json({ success: true, total: events.length, featured: selectedIds, predictionsFetched, predictionErrors })
}
