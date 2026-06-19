import { NextRequest, NextResponse } from "next/server"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { generateAiPredictions } from "@/lib/ai-predictions"

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const CRON_SECRET = process.env.CRON_SECRET
const HOUSE_NICKNAME = "TheOne"
const DEMO_EVENT_COUNT = 16
const BET_AMOUNT = 10
const FEE_RATE = 0.03

type SupabaseClient = ReturnType<typeof createAdminSupabaseClient>

async function getDemoStatus(supabase: SupabaseClient) {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "demo_mode").maybeSingle()
  return (data?.value as any) ?? { active: false, activated_at: null }
}

async function setDemoStatus(supabase: SupabaseClient, active: boolean) {
  const value = { active, activated_at: active ? new Date().toISOString() : null }
  await supabase.from("app_settings").upsert({ key: "demo_mode", value, updated_at: new Date().toISOString() })
  return value
}

// ── GET: current demo status ──────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response
  const supabase = createAdminSupabaseClient()
  const status = await getDemoStatus(supabase)
  const { count } = await supabase.from("events").select("*", { count: "exact", head: true }).eq("is_demo", true)
  return NextResponse.json({ ...status, demo_event_count: count ?? 0 })
}

// ── Bet creation (shared between template and AI paths) ───────────────────────
type DemoEvent = { id: number; sport: string; home_team: string; away_team: string; metadata: any }

async function createDemoBets(
  supabase: SupabaseClient,
  events: DemoEvent[],
  getSelection: (ev: DemoEvent) => string | undefined
): Promise<string[]> {
  const { data: houseProfile } = await supabase.from("profiles").select("id").eq("nickname", HOUSE_NICKNAME).single()
  if (!houseProfile) return []

  const betTypesForSport: Record<string, string[]> = {
    football: ["direct", "exact_score", "half_time"],
    basketball: ["direct", "score_margin"],
    baseball: ["direct", "run_line", "total_runs"],
  }

  const createdBets: string[] = []

  for (const ev of events) {
    const selection = getSelection(ev)
    if (!selection) continue

    const betTypes = betTypesForSport[ev.sport] || ["direct"]
    const totalNeeded = (BET_AMOUNT + BET_AMOUNT * FEE_RATE) * betTypes.length

    const { data: wallet } = await supabase.from("wallets").select("balance_fantasy").eq("user_id", houseProfile.id).single()
    if (wallet && wallet.balance_fantasy < totalNeeded) {
      await supabase.from("wallets").update({ balance_fantasy: wallet.balance_fantasy + totalNeeded * 2 }).eq("user_id", houseProfile.id)
    }

    for (const betType of betTypes) {
      let creatorSelection = selection
      let multiplier = 1

      if (betType === "exact_score") {
        creatorSelection = ev.sport === "baseball" ? "3-2" : ev.sport === "basketball" ? "102-95" : "1-0"
        multiplier = 5
      } else if (betType === "score_margin") {
        creatorSelection = "home_1_5"
      } else if (betType === "run_line") {
        creatorSelection = "home_rl"
      } else if (betType === "total_runs") {
        creatorSelection = "over_8"
      }

      const fee = BET_AMOUNT * FEE_RATE
      const { data: bet } = await supabase.from("bets").insert({
        event_id: ev.id,
        creator_id: houseProfile.id,
        bet_type: betType,
        selection: JSON.stringify({ selection: creatorSelection }),
        creator_selection: creatorSelection,
        amount: BET_AMOUNT,
        multiplier,
        fee_amount: fee,
        status: "open",
        mode: "fantasy",
        is_demo: true,
      }).select("id").single()

      if (bet) createdBets.push(bet.id)
    }
  }

  return createdBets
}

// ── POST: activate demo mode ──────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const cronHeader = request.headers.get("x-auto-resolve-secret")
  const isCron = CRON_SECRET && cronHeader === CRON_SECRET
  if (!isCron) {
    const auth = await requireBackofficeAdmin(request)
    if (!auth.authorized) return auth.response
  }

  const supabase = createAdminSupabaseClient()

  // Reset existing demo events
  await supabase.from("events").update({ is_demo: false, status: "finished" }).eq("is_demo", true)

  // Check for saved templates (uploaded via scripts/upload-demo-templates.ts)
  const { data: templateSetting } = await supabase
    .from("app_settings").select("value").eq("key", "demo_event_templates").maybeSingle()

  const templates: any[] = Array.isArray(templateSetting?.value) ? templateSetting!.value : []

  let confirmedEvents: Array<{ id: number; sport: string; home_team: string; away_team: string; metadata: any }> = []
  let mode: "templates" | "ai" = "templates"

  if (templates.length > 0) {
    // ── Path A: restore from saved templates (no Claude AI needed) ────────────
    const demoStartTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

    const eventRows = templates.map((t: any) => ({
      external_id: t.external_id,
      sport: t.sport,
      league: t.league,
      country: t.country ?? "Unknown",
      home_team: t.home_team,
      away_team: t.away_team,
      home_logo: t.home_logo ?? null,
      away_logo: t.away_logo ?? null,
      start_time: demoStartTime,
      status: "scheduled",
      home_score: null,
      away_score: null,
      featured: false,
      is_demo: true,
      metadata: t.metadata ?? {},
    }))

    const { data: upserted, error: upsertError } = await supabase
      .from("events")
      .upsert(eventRows, { onConflict: "external_id" })
      .select("id, sport, home_team, away_team, metadata")

    if (upsertError) return NextResponse.json({ error: `Error upserting events: ${upsertError.message}` }, { status: 500 })

    confirmedEvents = upserted ?? []
  } else {
    // ── Path B: AI-based selection (fallback when no templates saved) ─────────
    mode = "ai"
    if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })

    const SELECT_FIELDS = "id, sport, league, home_team, away_team, home_logo, away_logo, start_time, metadata"
    const QUALITY_FOOTBALL_LEAGUES = [
      "UEFA Champions League", "UEFA Europa League", "UEFA Conference League",
      "Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "Eredivisie",
      "Primeira Liga", "Copa Libertadores", "Copa Sudamericana", "CONMEBOL Sudamericana",
      "Liga Profesional Argentina", "Major League Soccer", "Liga MX",
      "J1 League", "K League 1", "Friendlies", "Copa America", "FIFA World Cup",
      "AFC Champions League", "CAF Champions League", "Copa do Nordeste",
      "Copa Colombia", "Copa Ecuador",
    ]

    const [footballRes, basketballRes, baseballRes] = await Promise.all([
      supabase.from("events").select(SELECT_FIELDS).eq("sport", "football").eq("is_demo", false)
        .in("league", QUALITY_FOOTBALL_LEAGUES).order("id", { ascending: false }).limit(100),
      supabase.from("events").select(SELECT_FIELDS).eq("sport", "basketball").eq("is_demo", false).order("id", { ascending: false }).limit(80),
      supabase.from("events").select(SELECT_FIELDS).eq("sport", "baseball").eq("is_demo", false).order("id", { ascending: false }).limit(50),
    ])

    const footballEvents = footballRes.data || []
    const basketballEvents = basketballRes.data || []
    const baseballEvents = baseballRes.data || []
    const events = [...footballEvents, ...basketballEvents, ...baseballEvents]

    if (!events.length) return NextResponse.json({ error: "No hay eventos en la base de datos" }, { status: 422 })

    const prompt = `Select exactly ${DEMO_EVENT_COUNT} events for a sports betting demo: EXACTLY 8 football, EXACTLY 5 basketball, EXACTLY 3 baseball.

FOOTBALL (pick exactly 8 — only well-known teams/leagues like Champions League, La Liga, Premier League, Copa Libertadores):
${footballEvents.map(e => `${e.id}|football|${e.league}|${e.home_team} vs ${e.away_team}`).join("\n") || "(none available)"}

BASKETBALL (pick exactly 5 — prefer NBA, EuroLeague, ACB, known leagues):
${basketballEvents.map(e => `${e.id}|basketball|${e.league}|${e.home_team} vs ${e.away_team}`).join("\n") || "(none available)"}

BASEBALL (pick exactly 3 — prefer MLB, NPB, KBO):
${baseballEvents.map(e => `${e.id}|baseball|${e.league}|${e.home_team} vs ${e.away_team}`).join("\n") || "(none available)"}

Rules: no duplicates (same two teams). Reply ONLY with JSON array of ${DEMO_EVENT_COUNT} IDs: [123,456,...]`

    let selectedIds: number[] = []
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 256, messages: [{ role: "user", content: prompt }] }),
      })
      const data = await res.json()
      const text: string = data?.content?.[0]?.text ?? ""
      const match = text.match(/\[[\d,\s]+\]/)
      if (!match) throw new Error("No JSON array in response")
      const parsed = JSON.parse(match[0])
      const validIds = new Set(events.map(e => e.id))
      selectedIds = (parsed as unknown[]).map(v => Number(v)).filter(id => Number.isFinite(id) && validIds.has(id)).slice(0, DEMO_EVENT_COUNT)
    } catch (e: any) {
      return NextResponse.json({ error: `Claude selection failed: ${e.message}` }, { status: 500 })
    }

    const selectedEvents = events.filter(e => selectedIds.includes(e.id))
    const demoStartTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

    await Promise.all(selectedEvents.map(ev =>
      supabase.from("events").update({ status: "scheduled", start_time: demoStartTime, home_score: null, away_score: null }).eq("id", ev.id)
    ))

    const eventsWithPredictions = new Set<number>()
    selectedEvents.forEach(e => {
      if ((e.metadata as any)?.predictions?.percent) eventsWithPredictions.add(e.id)
    })

    const eventsStripped = selectedEvents.map(e => ({ ...e, metadata: {} }))
    const aiPreds = await generateAiPredictions(eventsStripped as any)
    await Promise.all(Array.from(aiPreds.entries()).map(async ([eventId, prediction]) => {
      const ev = selectedEvents.find(e => e.id === eventId)
      await supabase.from("events").update({ metadata: { ...((ev?.metadata as any) || {}), predictions: prediction } }).eq("id", eventId)
      eventsWithPredictions.add(eventId)
    }))

    const confirmedIds = selectedIds.filter(id => eventsWithPredictions.has(id))
    if (confirmedIds.length === 0) return NextResponse.json({ error: "No se pudieron generar predicciones" }, { status: 422 })

    await supabase.from("events").update({ is_demo: true }).in("id", confirmedIds)

    // Fetch AI-based winner selections for bet creation
    const confirmedEventsRaw = selectedEvents.filter(e => confirmedIds.includes(e.id))
    const matchLines = confirmedEventsRaw.map(e => `${e.id}|${e.sport}|${e.home_team} vs ${e.away_team}`).join("\n")
    const selectPrompt = `Pick the most likely winner for each match. Football: team name or "Empate". Basketball/baseball: team name only.

${matchLines}

Reply ONLY: [{"id":123,"selection":"Team Name"},...]`

    let selMap = new Map<number, string>()
    try {
      const sRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: selectPrompt }] }),
      })
      const sData = await sRes.json()
      const sText: string = sData?.content?.[0]?.text ?? ""
      const sMatch = sText.match(/\[[\s\S]*\]/)
      if (sMatch) {
        const parsed: Array<{ id: number; selection: string }> = JSON.parse(sMatch[0])
        selMap = new Map(parsed.map(s => [s.id, s.selection]))
      }
    } catch (_) {}

    // Reload events with fresh metadata (predictions now saved)
    const { data: reloaded } = await supabase
      .from("events").select("id, sport, home_team, away_team, metadata").in("id", confirmedIds)
    confirmedEvents = reloaded ?? []

    const createdBets = await createDemoBets(supabase, confirmedEvents, ev => selMap.get(ev.id))
    await setDemoStatus(supabase, true)
    return NextResponse.json({ success: true, demo_events: confirmedEvents.length, demo_bets: createdBets.length, mode })
  }

  // Path A bet creation: use predictions.winner from template metadata
  const createdBets = await createDemoBets(supabase, confirmedEvents, (ev) => {
    const winner = (ev.metadata as any)?.predictions?.winner
    if (!winner) return undefined
    // Validate winner is a known team or "Empate"
    if (winner === "Empate") return winner
    if (winner === ev.home_team || winner === ev.away_team) return winner
    // Fuzzy match: winner is contained in team name or vice versa
    const w = winner.toLowerCase()
    if (ev.home_team.toLowerCase().includes(w) || w.includes(ev.home_team.toLowerCase())) return ev.home_team
    if (ev.away_team.toLowerCase().includes(w) || w.includes(ev.away_team.toLowerCase())) return ev.away_team
    return winner // use as-is if no match found
  })

  await setDemoStatus(supabase, true)
  return NextResponse.json({ success: true, demo_events: confirmedEvents.length, demo_bets: createdBets.length, mode })
}

// ── DELETE: deactivate demo mode ──────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response
  const supabase = createAdminSupabaseClient()
  await supabase.from("events").update({ is_demo: false }).eq("is_demo", true)
  await supabase.from("bets").update({ status: "cancelled" }).eq("is_demo", true).eq("status", "open")
  await setDemoStatus(supabase, false)
  return NextResponse.json({ success: true })
}
