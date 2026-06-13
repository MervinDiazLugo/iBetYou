import { NextRequest, NextResponse } from "next/server"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { generateAiPredictions } from "@/lib/ai-predictions"

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const HOUSE_NICKNAME = "TheOne"
const DEMO_EVENT_COUNT = 16
const BET_AMOUNT = 10
const FEE_RATE = 0.03

// Returns { active, activated_at } from app_settings
async function getDemoStatus(supabase: ReturnType<typeof createAdminSupabaseClient>) {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "demo_mode").maybeSingle()
  return (data?.value as any) ?? { active: false, activated_at: null }
}

async function setDemoStatus(supabase: ReturnType<typeof createAdminSupabaseClient>, active: boolean) {
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

const CRON_SECRET = process.env.CRON_SECRET

// ── POST: activate demo mode ──────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // Accept both backoffice admin auth AND cron secret (for demo-refresh cron)
  const cronHeader = request.headers.get("x-auto-resolve-secret")
  const isCron = CRON_SECRET && cronHeader === CRON_SECRET
  if (!isCron) {
    const auth = await requireBackofficeAdmin(request)
    if (!auth.authorized) return auth.response
  }

  if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })

  const supabase = createAdminSupabaseClient()

  // Reset existing demo events (restore original status)
  await supabase.from("events")
    .update({ is_demo: false, status: "finished" })
    .eq("is_demo", true)

  // Fetch top 100 events per sport to guarantee sport diversity.
  // Ordering by id DESC gives the most recently synced events (most likely upcoming).
  const SELECT_FIELDS = "id, sport, league, home_team, away_team, home_logo, away_logo, start_time, metadata"
  const [footballRes, basketballRes, baseballRes] = await Promise.all([
    // Football: oldest first — early inserts were top European/South American leagues (UCL, La Liga, etc.)
    // Recent inserts are mostly obscure USL lower-division events
    supabase.from("events").select(SELECT_FIELDS).eq("sport", "football").eq("is_demo", false).order("id", { ascending: true }).limit(200),
    supabase.from("events").select(SELECT_FIELDS).eq("sport", "basketball").eq("is_demo", false).order("id", { ascending: false }).limit(100),
    supabase.from("events").select(SELECT_FIELDS).eq("sport", "baseball").eq("is_demo", false).order("id", { ascending: false }).limit(100),
  ])

  const events = [
    ...(footballRes.data || []),
    ...(basketballRes.data || []),
    ...(baseballRes.data || []),
  ]

  if (!events.length) {
    return NextResponse.json({ error: "No hay eventos en la base de datos" }, { status: 422 })
  }

  // Ask Claude to pick DEMO_EVENT_COUNT events — no dates needed since we'll assign them
  const eventLines = events.map(e =>
    `${e.id}|${e.sport}|${e.league}|${e.home_team} vs ${e.away_team}`
  ).join("\n")

  const prompt = `Pick ${DEMO_EVENT_COUNT} events for a sports betting demo platform. Mix of sports. Prioritize well-known teams and leagues (e.g. Premier League, Champions League, NBA, Euroleague, MLB). Caps: football 6-10, basketball 1-5, baseball 0-5. No duplicates (same two teams).

Events (id|sport|league|match):
${eventLines}

Reply ONLY with JSON array of ${DEMO_EVENT_COUNT} IDs: [123,456,...]`

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
    if (!match) throw new Error("No JSON array")
    const parsed = JSON.parse(match[0])
    const validIds = new Set(events.map(e => e.id))
    selectedIds = (parsed as unknown[]).map(v => Number(v)).filter(id => Number.isFinite(id) && validIds.has(id)).slice(0, DEMO_EVENT_COUNT)
  } catch (e: any) {
    return NextResponse.json({ error: `Claude selection failed: ${e.message}` }, { status: 500 })
  }

  const selectedEvents = events.filter(e => selectedIds.includes(e.id))

  // All demo events start at the same time: 2h from now
  const demoStartTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  await Promise.all(selectedEvents.map(ev =>
    supabase.from("events").update({
      status: "scheduled",
      start_time: demoStartTime,
      home_score: null,
      away_score: null,
    }).eq("id", ev.id)
  ))

  const eventsWithPredictions = new Set<number>()

  // Seed with events that already have predictions — fallback if AI fails to regenerate
  selectedEvents.forEach(e => {
    if ((e.metadata as any)?.predictions?.percent) eventsWithPredictions.add(e.id)
  })

  // Force-regenerate AI predictions for ALL selected events — historical events have stale api-sports fixture IDs.
  // Strip existing predictions from metadata so generateAiPredictions treats every event as needing a fresh one.
  const eventsStripped = selectedEvents.map(e => ({ ...e, metadata: {} }))
  const aiPreds = await generateAiPredictions(eventsStripped as any)
  await Promise.all(Array.from(aiPreds.entries()).map(async ([eventId, prediction]) => {
    const ev = selectedEvents.find(e => e.id === eventId)
    await supabase.from("events").update({ metadata: { ...((ev?.metadata as any) || {}), predictions: prediction } }).eq("id", eventId)
    eventsWithPredictions.add(eventId)
  }))

  // Mark confirmed events as demo
  const confirmedIds = selectedIds.filter(id => eventsWithPredictions.has(id))
  if (confirmedIds.length === 0) return NextResponse.json({ error: "No se pudieron generar predicciones" }, { status: 422 })

  await supabase.from("events").update({ is_demo: true }).in("id", confirmedIds)

  // Create demo bets (TheOne bets on each event per sport bet type)
  const { data: houseProfile } = await supabase.from("profiles").select("id").eq("nickname", HOUSE_NICKNAME).single()
  const createdBets: string[] = []

  if (houseProfile && ANTHROPIC_API_KEY) {
    const confirmedEvents = selectedEvents.filter(e => confirmedIds.includes(e.id))
    const matchLines = confirmedEvents.map(e => `${e.id}|${e.sport}|${e.home_team} vs ${e.away_team}`).join("\n")
    const selectPrompt = `Pick the most likely winner for each match. Football: team name or "Empate". Basketball/baseball: team name only.

${matchLines}

Reply ONLY: [{"id":123,"selection":"Team Name"},...]`

    let selections: Array<{ id: number; selection: string }> = []
    try {
      const sRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: selectPrompt }] }),
      })
      const sData = await sRes.json()
      const sText: string = sData?.content?.[0]?.text ?? ""
      const sMatch = sText.match(/\[[\s\S]*\]/)
      if (sMatch) selections = JSON.parse(sMatch[0])
    } catch (_) {}

    const selMap = new Map(selections.map(s => [s.id, s.selection]))

    // Bet types per sport
    const betTypesForSport: Record<string, string[]> = {
      football: ["direct", "exact_score", "half_time"],
      basketball: ["direct", "score_margin"],
      baseball: ["direct", "run_line", "total_runs"],
    }

    for (const ev of confirmedEvents) {
      const selection = selMap.get(ev.id)
      if (!selection) continue
      const betTypes = betTypesForSport[ev.sport] || ["direct"]
      const totalNeeded = (BET_AMOUNT + BET_AMOUNT * FEE_RATE) * betTypes.length

      // Ensure wallet
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
        } else if (betType === "half_time") {
          creatorSelection = selection
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

        if (bet) {
          await supabase.from("wallets").update({}).eq("user_id", houseProfile.id)
          createdBets.push(bet.id)
        }
      }
    }
  }

  await setDemoStatus(supabase, true)

  return NextResponse.json({
    success: true,
    demo_events: confirmedIds.length,
    demo_bets: createdBets.length,
    skipped: selectedIds.length - confirmedIds.length,
  })
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
