import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

const CRON_SECRET = process.env.CRON_SECRET
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const MAX_FEATURED = 16
const LOOKAHEAD_DAYS = 3

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
    .select("id, sport, league, country, home_team, away_team, start_time, status")
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

  console.log("[cron/auto-featured]", { total: events.length, featured: selectedIds })

  return NextResponse.json({ success: true, total: events.length, featured: selectedIds })
}
