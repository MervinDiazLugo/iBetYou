import { NextRequest, NextResponse } from "next/server"
import https from "node:https"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { generateAiPredictions } from "@/lib/ai-predictions"

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY
const API_FOOTBALL_URL = process.env.API_FOOTBALL_URL
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

function fetchApiSports(url: string): Promise<any> {
  if (!API_FOOTBALL_KEY) return Promise.reject(new Error("API_FOOTBALL_KEY not set"))
  return new Promise((resolve, reject) => {
    const { hostname, pathname, search } = new URL(url)
    const req = https.request(
      { method: "GET", hostname, path: pathname + search, headers: { "x-apisports-key": API_FOOTBALL_KEY! } },
      (res) => {
        let body = ""
        res.on("data", (chunk) => { body += chunk })
        res.on("end", () => {
          try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
        })
      }
    )
    req.on("error", reject)
    req.end()
  })
}

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get("sport") || "all"
  const page = Math.max(0, parseInt(searchParams.get("page") || "0"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))
  const direction = searchParams.get("direction") || "all"
  const featuredOnly = searchParams.get("featured") === "true"

  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayStartISO = todayStart.toISOString()

  try {
    let query = supabase
      .from("events")
      .select("id, sport, league, country, home_team, away_team, home_logo, away_logo, start_time, status, external_id, featured, home_score, away_score, metadata", { count: "exact" })
      .range(page * limit, page * limit + limit - 1)

    if (direction === "upcoming") {
      query = query.gte("start_time", todayStartISO).order("start_time", { ascending: true })
    } else if (direction === "past") {
      query = query.lt("start_time", todayStartISO).order("start_time", { ascending: false })
    } else {
      query = query.order("start_time", { ascending: true })
    }

    if (featuredOnly) {
      query = query.eq("featured", true)
    } else if (sport !== "all") {
      query = query.eq("sport", sport)
    }

    const { data, error, count } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ events: data || [], total: count ?? 0, page, limit })
  } catch (error: unknown) {
    console.error("Admin events GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  try {
    const body = await request.json()
    const { action, sport, league, home_team, away_team, start_time, country } = body

    if (action === "sync") {
      if (!API_FOOTBALL_KEY || !API_FOOTBALL_URL) {
        return NextResponse.json({ error: "API not configured" }, { status: 500 })
      }

      let data: any
      try {
        data = await fetchApiSports(`${API_FOOTBALL_URL}/fixtures?date=${new Date().toISOString().split("T")[0]}`)
      } catch {
        return NextResponse.json({ error: "Failed to fetch from external API" }, { status: 500 })
      }
      if (!data.response || data.response.length === 0) {
        return NextResponse.json({ message: "No events found", events: [] })
      }

      interface ApiFixture {
        league: { name: string; country?: string }
        teams: { home: { name: string; logo: string }; away: { name: string; logo: string } }
        fixture: { id: number; date: string }
      }

      const events = (data.response as ApiFixture[]).map((fixture) => ({
        sport: "football",
        league: fixture.league.name,
        country: fixture.league.country || "Unknown",
        home_team: fixture.teams.home.name,
        away_team: fixture.teams.away.name,
        home_logo: fixture.teams.home.logo,
        away_logo: fixture.teams.away.logo,
        start_time: fixture.fixture.date,
        status: "scheduled",
        external_id: `football_${fixture.fixture.id}`,
      }))

      const { count } = await batchUpsertEvents(supabase, events)
      return NextResponse.json({ success: true, count })
    }

    if (action === "create") {
      if (!home_team || !away_team || !start_time) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
      }

      const { data: event, error } = await supabase
        .from("events")
        .insert({
          sport: sport || "football",
          league: league || "Friendly",
          country: country || "Unknown",
          home_team,
          away_team,
          start_time,
          status: "scheduled",
        })
        .select()
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, event })
    }

    if (action === "bulk_create") {
      const { events } = body

      if (!events || !Array.isArray(events) || events.length === 0) {
        return NextResponse.json({ error: "No events to insert" }, { status: 400 })
      }

      const { count, error } = await batchUpsertEvents(supabase, events)
      if (error) return NextResponse.json({ error }, { status: 500 })
      return NextResponse.json({ success: true, count })
    }

    if (action === "cleanup_no_bets") {
      // Delete ALL events that have no bets (any status, any date)
      const { data: allEvents, error: allErr } = await supabase
        .from("events")
        .select("id")

      if (allErr) return NextResponse.json({ error: allErr.message }, { status: 500 })
      if (!allEvents || allEvents.length === 0) {
        return NextResponse.json({ success: true, deleted: 0 })
      }

      const allIds = allEvents.map((e) => e.id)

      const { data: betsRefs, error: betsErr } = await supabase
        .from("bets")
        .select("event_id")
        .in("event_id", allIds)

      if (betsErr) return NextResponse.json({ error: betsErr.message }, { status: 500 })

      const withBets = new Set((betsRefs || []).map((b) => b.event_id))
      const toDelete = allIds.filter((id) => !withBets.has(id))

      let deleted = 0
      for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = toDelete.slice(i, i + BATCH_SIZE)
        const { error: delErr } = await supabase.from("events").delete().in("id", batch)
        if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
        deleted += batch.length
      }

      return NextResponse.json({ success: true, deleted, protected: withBets.size })
    }

    if (action === "cleanup_old") {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

      // 1. Get all event IDs older than 2 weeks
      const { data: oldEvents, error: oldError } = await supabase
        .from("events")
        .select("id")
        .lt("start_time", twoWeeksAgo)

      if (oldError) return NextResponse.json({ error: oldError.message }, { status: 500 })
      if (!oldEvents || oldEvents.length === 0) {
        return NextResponse.json({ success: true, deleted: 0, protected: 0 })
      }

      const oldIds = oldEvents.map((e) => e.id)

      // 2. Find which of those have bets (must not be deleted)
      const { data: betsRefs, error: betsError } = await supabase
        .from("bets")
        .select("event_id")
        .in("event_id", oldIds)

      if (betsError) return NextResponse.json({ error: betsError.message }, { status: 500 })

      const protectedIds = new Set((betsRefs || []).map((b) => b.event_id))
      const toDelete = oldIds.filter((id) => !protectedIds.has(id))

      // 3. Batch delete only events with no bets
      let deleted = 0
      for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = toDelete.slice(i, i + BATCH_SIZE)
        const { error: delError } = await supabase.from("events").delete().in("id", batch)
        if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })
        deleted += batch.length
      }

      return NextResponse.json({
        success: true,
        deleted,
        protected: protectedIds.size,
      })
    }

    if (action === "dedup") {
      // 1. Fetch all events that have an external_id, ordered by id asc
      const { data: allExternal, error: fetchErr } = await supabase
        .from("events")
        .select("id, external_id")
        .not("external_id", "is", null)
        .order("id", { ascending: true })

      if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

      // 2. Group by external_id — keep lowest id, collect the rest as duplicates
      const groups = new Map<string, number[]>()
      for (const e of allExternal || []) {
        const key = e.external_id as string
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(e.id as number)
      }

      const duplicateGroups = [...groups.entries()].filter(([, ids]) => ids.length > 1)
      if (duplicateGroups.length === 0) {
        return NextResponse.json({ success: true, removed: 0, message: "No hay duplicados" })
      }

      let removed = 0
      for (const [, ids] of duplicateGroups) {
        const keepId = ids[0]
        const deleteIds = ids.slice(1)

        // Reassign bets from duplicate events to the kept event BEFORE deleting
        // (avoids ON DELETE CASCADE wiping bet history)
        for (const deleteId of deleteIds) {
          await supabase.from("bets").update({ event_id: keepId }).eq("event_id", deleteId)
        }

        // Delete the duplicates (safe now — no bets reference them)
        const { error: delErr } = await supabase.from("events").delete().in("id", deleteIds)
        if (!delErr) removed += deleteIds.length
      }

      return NextResponse.json({ success: true, removed, groups: duplicateGroups.length })
    }

    if (action === "refresh_featured_predictions") {
      const { data: allFeatured, error: fetchErr } = await supabase
        .from("events")
        .select("id, external_id, sport, league, home_team, away_team, metadata")
        .eq("featured", true)
        .in("status", ["scheduled", "live"])

      if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

      let fetched = 0
      const errors: string[] = []

      // Football: fetch from api-sports.io
      if (API_FOOTBALL_KEY && API_FOOTBALL_URL) {
        const footballEvents = (allFeatured || []).filter(e => (e as any).sport === "football" && e.external_id?.startsWith("football_"))
        for (const ev of footballEvents) {
          const fixtureId = ev.external_id!.replace("football_", "")
          try {
            const data = await fetchApiSports(`${API_FOOTBALL_URL}/predictions?fixture=${fixtureId}`)
            const raw = data.response?.[0]
            if (!raw) continue
            const pred = raw.predictions
            const home = raw.teams?.home
            const away = raw.teams?.away
            const predictions = {
              percent: pred?.percent ?? null, advice: pred?.advice ?? null, winner: pred?.winner?.name ?? null,
              home_form: home?.last_5?.form ?? null, away_form: away?.last_5?.form ?? null,
              home_goals_avg: home?.last_5?.goals?.for?.average ?? null, away_goals_avg: away?.last_5?.goals?.for?.average ?? null,
              home_league_form: home?.league?.form ?? null, away_league_form: away?.league?.form ?? null,
              comparison: raw.comparison ?? null,
              h2h: (raw.h2h ?? []).slice(0, 5).map((m: any) => ({
                date: m.fixture?.date?.split("T")[0] ?? null, home: m.teams?.home?.name ?? null,
                away: m.teams?.away?.name ?? null, home_score: m.goals?.home ?? null, away_score: m.goals?.away ?? null,
              })),
            }
            await supabase.from("events").update({ metadata: { ...(ev.metadata || {}), predictions } }).eq("id", ev.id)
            fetched++
          } catch (e: any) {
            errors.push(`${ev.external_id}: ${e.message}`)
          }
        }
      }

      // AI predictions for all remaining events without predictions (baseball, basketball, football without API data)
      const needsAiPred = (allFeatured || []).filter(e => !(e as any).metadata?.predictions?.percent)
      if (needsAiPred.length > 0) {
        const aiPreds = await generateAiPredictions(needsAiPred as any)
        for (const [eventId, prediction] of aiPreds) {
          const ev = (featuredEvents || []).find(e => e.id === eventId)
          await supabase.from("events").update({ metadata: { ...((ev as any).metadata || {}), predictions: prediction } }).eq("id", eventId)
          fetched++
        }
      }

      return NextResponse.json({ success: true, fetched, errors, total: allFeatured?.length ?? 0 })
    }

    if (action === "run_auto_featured") {
      if (!ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
      }

      const MAX_FEATURED = 16
      const LOOKAHEAD_DAYS = 3
      const now = new Date()
      const cutoff = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)

      const { data: events, error: evErr } = await supabase
        .from("events")
        .select("id, external_id, sport, league, country, home_team, away_team, start_time, status, metadata")
        .in("status", ["scheduled", "live"])
        .gte("start_time", now.toISOString())
        .lte("start_time", cutoff.toISOString())
        .order("start_time", { ascending: true })

      if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })
      if (!events || events.length < 3) {
        return NextResponse.json({ success: true, message: "Not enough upcoming events to curate", featured: [] })
      }

      const eventList = events.map(e => ({
        id: e.id, sport: e.sport, league: e.league, country: e.country,
        match: `${e.home_team} vs ${e.away_team}`, start_time: e.start_time,
      }))

      const ftCount = events.filter(e => e.sport === "football").length
      const bkCount = events.filter(e => e.sport === "basketball").length
      const bbCount = events.filter(e => e.sport === "baseball").length

      const prompt = `You are curating featured events for iBetYou, a Venezuelan P2P sports betting platform.

Select exactly ${MAX_FEATURED} events from the list below.

HARD SPORT CAPS — you MUST respect these limits regardless of availability:
- football (soccer): minimum 4, maximum 8 (if ${ftCount} available)
- baseball (MLB): maximum 5
- basketball (NBA): minimum 1 (if available), maximum 4

MANDATORY FOOTBALL — always include these if present:
- UEFA Champions League, UEFA Europa League knockouts
- Copa América, Copa Libertadores knockouts, Copa Sudamericana knockouts
- FIFA World Cup / Qualifiers (CONMEBOL)
- Premier League, La Liga, Bundesliga, Serie A matches involving top clubs

MANDATORY OTHER SPORTS — always include if present:
- NBA Playoffs / Finals games
- At least 1 MLB game (but no more than 5 total)

FOOTBALL SELECTION PRIORITY (fill football slots with):
1. Top clubs: Real Madrid, Barcelona, Man City, Liverpool, Arsenal, PSG, Bayern, Juventus
2. High-profile derbies and rivalry matches
3. Any Premier League, La Liga, Bundesliga, Serie A, Ligue 1 game
4. Venezuelan fans follow South American football closely — weight Copa Libertadores

Available: ${ftCount} football, ${bkCount} basketball, ${bbCount} baseball

Upcoming events (next ${LOOKAHEAD_DAYS} days):
${JSON.stringify(eventList, null, 2)}
Respond with ONLY a JSON array of exactly ${MAX_FEATURED} event IDs. Example: [123, 456, 789]
No explanation. No markdown. Just the raw JSON array.`

      let selectedIds: number[] = []
      try {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
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
        if (!aiRes.ok) {
          const body = await aiRes.text()
          return NextResponse.json({ error: `Claude API error: ${aiRes.status} ${body}` }, { status: 500 })
        }
        const aiData = await aiRes.json()
        const text: string = aiData?.content?.[0]?.text ?? ""
        const match = text.match(/\[[\d,\s]+\]/)
        if (!match) return NextResponse.json({ error: "Claude returned unparseable response", raw: text }, { status: 500 })
        const parsed: unknown = JSON.parse(match[0])
        if (!Array.isArray(parsed)) throw new Error("Not an array")
        const validIds = new Set(events.map(e => e.id))
        const rawIds = (parsed as unknown[]).map(v => Number(v)).filter(id => Number.isFinite(id) && validIds.has(id))
        const evMap = new Map(events.map(e => [e.id, e]))
        const ftIds = rawIds.filter(id => evMap.get(id)?.sport === "football").slice(0, 8)
        const bkIds = rawIds.filter(id => evMap.get(id)?.sport === "basketball").slice(0, 4)
        const bbIds = rawIds.filter(id => evMap.get(id)?.sport === "baseball").slice(0, 5)
        let enforcedIds = [...ftIds, ...bkIds, ...bbIds]
        if (enforcedIds.length < MAX_FEATURED) {
          const included = new Set(enforcedIds)
          const extra = events.filter(e => e.sport === "football" && !included.has(e.id)).slice(0, MAX_FEATURED - enforcedIds.length).map(e => e.id)
          enforcedIds = [...enforcedIds, ...extra]
        }
        selectedIds = enforcedIds.slice(0, MAX_FEATURED)
      } catch (e: any) {
        return NextResponse.json({ error: `Failed to parse Claude response: ${e.message}` }, { status: 500 })
      }

      await supabase.from("events").update({ featured: false }).eq("featured", true)
      if (selectedIds.length > 0) {
        await supabase.from("events").update({ featured: true }).in("id", selectedIds)
      }

      // Fetch predictions for featured football events
      const footballEvents = events.filter(e => selectedIds.includes(e.id) && e.sport === "football" && e.external_id?.startsWith("football_"))
      let predictionsFetched = 0
      const predictionErrors: string[] = []
      if (API_FOOTBALL_KEY && API_FOOTBALL_URL) {
        for (const ev of footballEvents) {
          const fixtureId = ev.external_id.replace("football_", "")
          try {
            const data = await fetchApiSports(`${API_FOOTBALL_URL}/predictions?fixture=${fixtureId}`)
            const raw = data.response?.[0]
            if (!raw) continue
            const pred = raw.predictions
            const home = raw.teams?.home
            const away = raw.teams?.away
            const predictions = {
              percent: pred?.percent ?? null, advice: pred?.advice ?? null, winner: pred?.winner?.name ?? null,
              home_form: home?.last_5?.form ?? null, away_form: away?.last_5?.form ?? null,
              home_goals_avg: home?.last_5?.goals?.for?.average ?? null, away_goals_avg: away?.last_5?.goals?.for?.average ?? null,
              home_league_form: home?.league?.form ?? null, away_league_form: away?.league?.form ?? null,
              comparison: raw.comparison ?? null,
              h2h: (raw.h2h ?? []).slice(0, 5).map((m: any) => ({
                date: m.fixture?.date?.split("T")[0] ?? null, home: m.teams?.home?.name ?? null,
                away: m.teams?.away?.name ?? null, home_score: m.goals?.home ?? null, away_score: m.goals?.away ?? null,
              })),
            }
            await supabase.from("events").update({ metadata: { ...(ev.metadata || {}), predictions } }).eq("id", ev.id)
            predictionsFetched++
          } catch (e: any) {
            predictionErrors.push(`${ev.external_id}: ${e.message}`)
          }
        }
      }

      // AI predictions for events still missing them (baseball, basketball, football without API data)
      const selectedEventsAll = events.filter(e => selectedIds.includes(e.id))
      const needsAi = selectedEventsAll.filter(e => !(e.metadata as any)?.predictions?.percent)
      const aiPredictions = await generateAiPredictions(needsAi)
      let aiPredictionsFetched = 0
      for (const [eventId, prediction] of aiPredictions) {
        const ev = selectedEventsAll.find(e => e.id === eventId)
        await supabase.from("events").update({ metadata: { ...(ev?.metadata || {}), predictions: prediction } }).eq("id", eventId)
        aiPredictionsFetched++
      }

      return NextResponse.json({ success: true, total: events.length, featured: selectedIds, predictionsFetched, aiPredictionsFetched, predictionErrors })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error: unknown) {
    console.error("Admin events POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  try {
    const body = await request.json()
    const { id, featured, reset_scores, set_score } = body

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    if (reset_scores) {
      const { error } = await supabase
        .from("events")
        .update({ status: "scheduled", home_score: null, away_score: null, metadata: null })
        .eq("id", id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, action: "reset_scores" })
    }

    if (set_score) {
      const homeScore = Number(set_score.home_score)
      const awayScore = Number(set_score.away_score)
      const status = set_score.status || "finished"

      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore < 0 || awayScore < 0) {
        return NextResponse.json({ error: "home_score y away_score deben ser números válidos" }, { status: 400 })
      }
      if (!["scheduled", "live", "finished"].includes(status)) {
        return NextResponse.json({ error: "status inválido" }, { status: 400 })
      }

      const { data: updatedEvent, error } = await supabase
        .from("events")
        .update({ home_score: homeScore, away_score: awayScore, status })
        .eq("id", id)
        .select("id, home_team, away_team, home_score, away_score, status")
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, event: updatedEvent, action: "set_score" })
    }

    if (typeof featured !== "boolean") {
      return NextResponse.json({ error: "featured (boolean), reset_scores, o set_score son requeridos" }, { status: 400 })
    }

    const { error } = await supabase.from("events").update({ featured }).eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // When starring an event, fetch/generate predictions immediately
    if (featured) {
      const { data: ev } = await supabase.from("events").select("id, external_id, metadata, sport, league, home_team, away_team").eq("id", id).single()
      if (ev) {
        let gotApiPredictions = false

        // Football: try api-sports.io first
        if (ev.sport === "football" && ev.external_id?.startsWith("football_") && API_FOOTBALL_URL) {
          const fixtureId = ev.external_id.replace("football_", "")
          try {
            const data = await fetchApiSports(`${API_FOOTBALL_URL}/predictions?fixture=${fixtureId}`)
            const raw = data.response?.[0]
            if (raw) {
              const pred = raw.predictions
              const home = raw.teams?.home
              const away = raw.teams?.away
              const predictions = {
                percent: pred?.percent ?? null, advice: pred?.advice ?? null, winner: pred?.winner?.name ?? null,
                home_form: home?.last_5?.form ?? null, away_form: away?.last_5?.form ?? null,
                home_goals_avg: home?.last_5?.goals?.for?.average ?? null, away_goals_avg: away?.last_5?.goals?.for?.average ?? null,
                home_league_form: home?.league?.form ?? null, away_league_form: away?.league?.form ?? null,
                comparison: raw.comparison ?? null,
                h2h: (raw.h2h ?? []).slice(0, 5).map((m: any) => ({
                  date: m.fixture?.date?.split("T")[0] ?? null, home: m.teams?.home?.name ?? null,
                  away: m.teams?.away?.name ?? null, home_score: m.goals?.home ?? null, away_score: m.goals?.away ?? null,
                })),
              }
              await supabase.from("events").update({ metadata: { ...(ev.metadata || {}), predictions } }).eq("id", id)
              gotApiPredictions = true
            }
          } catch (predErr) {
            console.error("Failed to fetch predictions for featured event", id, predErr)
          }
        }

        // Fallback to AI predictions (baseball, basketball, or football without API data)
        if (!gotApiPredictions && !(ev.metadata as any)?.predictions?.percent) {
          const aiPreds = await generateAiPredictions([ev as any])
          const aiPred = aiPreds.get(ev.id)
          if (aiPred) {
            await supabase.from("events").update({ metadata: { ...(ev.metadata || {}), predictions: aiPred } }).eq("id", id)
          }
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error("Admin patch event error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) return NextResponse.json({ error: "Event ID is required" }, { status: 400 })

  try {
    const { error } = await supabase.from("events").delete().eq("id", parseInt(id))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error("Admin delete event error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500

/**
 * Upsert events efficiently:
 * 1. One SELECT to find all existing external_ids
 * 2. Batch INSERT new events in chunks of BATCH_SIZE
 * 3. Sequential UPDATE only for already-existing ones (usually very few)
 */
async function batchUpsertEvents(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  events: Record<string, unknown>[]
): Promise<{ count: number; error?: string }> {
  // Deduplicate input by external_id (last occurrence wins)
  const dedupMap = new Map<string, Record<string, unknown>>()
  const noExternalId: Record<string, unknown>[] = []
  for (const event of events) {
    if (event.external_id) {
      dedupMap.set(event.external_id as string, event)
    } else {
      noExternalId.push(event)
    }
  }
  events = [...dedupMap.values(), ...noExternalId]

  const externalIds = events.map((e) => e.external_id).filter(Boolean)

  const existingMap = new Map<string, number>()

  if (externalIds.length > 0) {
    const { data: existing, error: fetchError } = await supabase
      .from("events")
      .select("id, external_id")
      .in("external_id", externalIds)

    if (fetchError) return { count: 0, error: fetchError.message }

    for (const e of existing || []) {
      existingMap.set((e as { id: number; external_id: string }).external_id, (e as { id: number; external_id: string }).id)
    }
  }

  const toInsert = events.filter((e) => !existingMap.has(e.external_id as string))
  const toUpdate = events.filter((e) => existingMap.has(e.external_id as string))

  let count = 0

  // Batch inserts
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase.from("events").insert(batch).select("id")
    if (error) return { count, error: error.message }
    count += (data || []).length
  }

  // Sequential updates (typically few — events already saved)
  for (const event of toUpdate) {
    const id = existingMap.get(event.external_id as string)
    const { error } = await supabase.from("events").update(event).eq("id", id)
    if (error) return { count, error: error.message }
    count++
  }

  return { count }
}
