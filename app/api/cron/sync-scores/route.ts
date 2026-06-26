import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { cleanupExpiredOpenBets } from "@/lib/open-bets-cleanup"
import { cancelBetsForEvent } from "@/lib/cancel-bets-for-event"
import {
  mapTsdbStatus,
  normalizeTsdbEvent,
  tsdbLivescoreSoccer,
  tsdbLivescoreBasketball,
  tsdbLivescoreBaseball,
  tsdbLookupEvent,
  tsdbEventTimeline,
  extractFirstScorer,
  extractYellowCards,
  parseBaseballInnings,
  parseBasketballQuarters,
} from "@/lib/tsdb"

const CRON_SECRET = process.env.CRON_SECRET

// Events older than this are force-finished even if the API disagrees
const FORCE_FINISH_AFTER_MS = 4 * 60 * 60 * 1000
// Window: sync events that started between 30 min and 8h ago
const WINDOW_MIN_MS = 30 * 60 * 1000
const WINDOW_MAX_MS = 8 * 60 * 60 * 1000

function toScore(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.THESPORTSDB_API_KEY) {
    return NextResponse.json({ error: "THESPORTSDB_API_KEY not configured" }, { status: 500 })
  }

  const supabase = createAdminSupabaseClient()
  const now = Date.now()
  const apiErrors: string[] = []
  let apiCalls = 0

  // ── 1. Find events with active bets in sync window ───────────────────────
  const { data: activeBets, error: betsError } = await supabase
    .from("bets")
    .select("bet_type, event:events!event_id(id, external_id, sport, start_time, status, metadata)")
    .in("status", ["taken", "disputed"])

  if (betsError) return NextResponse.json({ error: betsError.message }, { status: 500 })

  // Deduplicate events, track if any bet needs first_scorer
  const eventMap = new Map<number, {
    id: number
    external_id: string
    sport: string
    start_time: string
    status: string
    metadata: any
    hasFirstScorer: boolean
    hasCardsOverUnder: boolean
    hasFirstInningScore: boolean
    hasTotalHits: boolean
    hasFirstHalfWinner: boolean
  }>()

  for (const bet of activeBets || []) {
    const event = Array.isArray((bet as any).event) ? (bet as any).event[0] : (bet as any).event
    if (!event || event.status === "finished" || event.status === "postponed") continue
    if (!event.external_id?.startsWith("tsdb_")) continue // only sync TheSportsDB events

    const startMs = new Date(event.start_time).getTime()
    if (startMs + WINDOW_MIN_MS > now) continue  // hasn't started yet (< 30 min ago)
    if (startMs + WINDOW_MAX_MS < now) continue  // too old (> 8h ago)

    const existing = eventMap.get(event.id)
    const betType = (bet as any).bet_type
    eventMap.set(event.id, {
      ...event,
      hasFirstScorer: existing?.hasFirstScorer || betType === "first_scorer",
      hasCardsOverUnder: existing?.hasCardsOverUnder || betType === "cards_over_under",
      hasFirstInningScore: existing?.hasFirstInningScore || betType === "first_inning_score",
      hasTotalHits: existing?.hasTotalHits || betType === "total_hits_over_under",
      hasFirstHalfWinner: existing?.hasFirstHalfWinner || betType === "first_half_winner",
    })
  }

  // Also include featured events that started today and aren't finished yet
  const todayUtcStart = new Date(now)
  todayUtcStart.setUTCHours(0, 0, 0, 0)
  const { data: featuredEvents } = await supabase
    .from("events")
    .select("id, external_id, sport, start_time, status, metadata")
    .eq("featured", true)
    .neq("status", "finished")
    .gte("start_time", todayUtcStart.toISOString())
    .lte("start_time", new Date(now).toISOString())

  for (const event of featuredEvents || []) {
    if (!event.external_id?.startsWith("tsdb_")) continue
    if (!eventMap.has(event.id)) {
      eventMap.set(event.id, { ...event, hasFirstScorer: false, hasCardsOverUnder: false, hasFirstInningScore: false, hasTotalHits: false, hasFirstHalfWinner: false })
    }
  }

  // ── 2. Fetch live scores from TheSportsDB V2 livescore endpoints ─────────
  const liveScoreMap = new Map<string, { homeScore: number | null; awayScore: number | null; status: string; rawStatus: string }>()

  try {
    const [soccerLive, basketballLive, baseballLive] = await Promise.all([
      tsdbLivescoreSoccer().catch((e) => { apiErrors.push(`livescore/soccer: ${e.message}`); return [] }),
      tsdbLivescoreBasketball().catch((e) => { apiErrors.push(`livescore/basketball: ${e.message}`); return [] }),
      tsdbLivescoreBaseball().catch((e) => { apiErrors.push(`livescore/baseball: ${e.message}`); return [] }),
    ])
    apiCalls += 3

    for (const item of [...soccerLive, ...basketballLive, ...baseballLive]) {
      const key = `tsdb_${item.idEvent}`
      liveScoreMap.set(key, {
        homeScore: toScore(item.intHomeScore),
        awayScore: toScore(item.intAwayScore),
        status: mapTsdbStatus(item.strStatus),
        rawStatus: (item.strStatus || "").toUpperCase(), // original for HT detection
      })
    }
  } catch (e: any) {
    apiErrors.push(`livescore batch: ${e.message}`)
  }

  if (eventMap.size === 0 && liveScoreMap.size === 0) {
    const cleanupResult = await cleanupExpiredOpenBets(supabase, "system")
    return NextResponse.json({ success: true, message: "No events in sync window", apiCalls, cleanup: cleanupResult })
  }

  // ── 3. For events in window NOT found in livescore, fetch individually ───
  const strResultDataMap = new Map<number, string>()
  const justFinished: Array<{ id: number; external_id: string; hasFirstScorer: boolean; hasCardsOverUnder: boolean; hasFirstInningScore: boolean; hasTotalHits: boolean; hasFirstHalfWinner: boolean; sport: string }> = []
  const justPostponed: number[] = []
  let updated = 0

  await Promise.all(
    Array.from(eventMap.values()).map(async (event) => {
      let scoreData = liveScoreMap.get(event.external_id)

      if (!scoreData) {
        // Not in livescore — fetch individually (probably just finished)
        const idEvent = event.external_id.replace("tsdb_", "")
        try {
          const raw = await tsdbLookupEvent(idEvent)
          apiCalls++
          if (raw) {
            scoreData = {
              homeScore: toScore(raw.intHomeScore),
              awayScore: toScore(raw.intAwayScore),
              status: mapTsdbStatus(raw.strStatus),
              rawStatus: (raw.strStatus || "").toUpperCase(),
            }
            if (raw.strResult && (event.sport === "baseball" || event.sport === "basketball")) {
              strResultDataMap.set(event.id, raw.strResult)
            }
          }
        } catch (e: any) {
          apiErrors.push(`lookup/${event.external_id}: ${e.message}`)
          return
        }
      }

      if (!scoreData) return

      // Force-finish if event is old enough
      const startMs = new Date(event.start_time).getTime()
      if (now - startMs >= FORCE_FINISH_AFTER_MS && scoreData.status !== "finished") {
        scoreData.status = "finished"
      }

      const metadata = event.metadata || {}
      const matchDetails = { ...(metadata.match_details || {}) }

      // Capture halftime score when game is at HT status
      if (scoreData.rawStatus === "HT" && scoreData.homeScore !== null) {
        if (!matchDetails.halftime_home_score) {
          matchDetails.halftime_home_score = scoreData.homeScore
          matchDetails.halftime_away_score = scoreData.awayScore
        }
      }

      await supabase.from("events").update({
        status: scoreData.status,
        home_score: scoreData.homeScore,
        away_score: scoreData.awayScore,
        metadata: { ...metadata, match_details: matchDetails },
      }).eq("id", event.id)

      updated++

      if (scoreData.status === "finished") {
        justFinished.push({ id: event.id, external_id: event.external_id, hasFirstScorer: event.hasFirstScorer, hasCardsOverUnder: event.hasCardsOverUnder, hasFirstInningScore: event.hasFirstInningScore, hasTotalHits: event.hasTotalHits, hasFirstHalfWinner: event.hasFirstHalfWinner, sport: event.sport })
      }
      if (scoreData.status === "postponed") {
        justPostponed.push(event.id)
      }
    })
  )

  // ── 4. Fetch timeline for finished football events (first_scorer + cards) ──
  for (const ev of justFinished) {
    const needsTimeline = ev.sport === "football" && (ev.hasFirstScorer || ev.hasCardsOverUnder)
    if (!needsTimeline) continue

    const idEvent = ev.external_id.replace("tsdb_", "")
    try {
      const timeline = await tsdbEventTimeline(idEvent)
      apiCalls++

      const { data: eventRow } = await supabase.from("events").select("metadata").eq("id", ev.id).single()
      const md = eventRow?.metadata || {}
      const matchDetails = { ...(md.match_details || {}) }

      if (ev.hasFirstScorer) {
        const firstGoal = extractFirstScorer(timeline)
        if (firstGoal) matchDetails.first_scorer = firstGoal
      }

      if (ev.hasCardsOverUnder) {
        const cards = extractYellowCards(timeline)
        matchDetails.yellow_cards_home = cards.home
        matchDetails.yellow_cards_away = cards.away
        matchDetails.yellow_cards_total = cards.total
      }

      await supabase.from("events").update({ metadata: { ...md, match_details: matchDetails } }).eq("id", ev.id)
    } catch (e: any) {
      apiErrors.push(`timeline/${ev.external_id}: ${e.message}`)
    }
  }

  // ── 4b. Parse strResult for finished baseball/basketball events ────────────
  for (const ev of justFinished) {
    if (ev.sport !== "baseball" && ev.sport !== "basketball") continue
    const hasStrResultBet = ev.hasFirstInningScore || ev.hasTotalHits || ev.hasFirstHalfWinner
    if (!hasStrResultBet) continue

    let strResult = strResultDataMap.get(ev.id) ?? null
    if (!strResult) {
      const idEvent = ev.external_id.replace("tsdb_", "")
      try {
        const raw = await tsdbLookupEvent(idEvent)
        apiCalls++
        strResult = raw?.strResult || null
      } catch (e: any) {
        apiErrors.push(`strResult/${ev.external_id}: ${e.message}`)
        continue
      }
    }
    if (!strResult) continue

    const { data: eventRow } = await supabase.from("events").select("metadata").eq("id", ev.id).single()
    const md = eventRow?.metadata || {}
    const matchDetails = { ...(md.match_details || {}) }
    let changed = false

    if (ev.sport === "baseball") {
      const parsed = parseBaseballInnings(strResult)
      if (parsed) {
        matchDetails.first_inning_home = parsed.homeInnings[0] ?? null
        matchDetails.first_inning_away = parsed.awayInnings[0] ?? null
        matchDetails.total_home_hits = parsed.homeHits
        matchDetails.total_away_hits = parsed.awayHits
        changed = true
      }
    } else if (ev.sport === "basketball") {
      const parsed = parseBasketballQuarters(strResult)
      if (parsed && parsed.homeQuarters.length >= 2 && parsed.awayQuarters.length >= 2) {
        matchDetails.half1_home = parsed.homeQuarters[0] + parsed.homeQuarters[1]
        matchDetails.half1_away = parsed.awayQuarters[0] + parsed.awayQuarters[1]
        changed = true
      }
    }

    if (changed) {
      await supabase.from("events").update({ metadata: { ...md, match_details: matchDetails } }).eq("id", ev.id)
    }
  }

  // ── 5. Trigger auto-resolve for each just-finished event ─────────────────
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")

  const resolveResults = await Promise.all(
    justFinished.map(async (ev) => {
      try {
        const res = await fetch(`${baseUrl}/api/admin/bets/auto-resolve-finished`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${CRON_SECRET}` },
          body: JSON.stringify({ event_id: ev.id }),
        })
        return { ok: res.ok, id: ev.id, status: res.status }
      } catch (e: any) {
        return { ok: false, id: ev.id, error: e.message }
      }
    })
  )
  const resolvedEvents = resolveResults.filter((r) => r.ok).map((r) => r.id)
  for (const r of resolveResults) {
    if (!r.ok) apiErrors.push(`auto-resolve/event_${r.id}: ${"error" in r ? r.error : `HTTP ${r.status}`}`)
  }

  // ── 6. Retry: finished events with missing metadata (half_time/first_scorer) ──
  const { data: pendingMetaBets } = await supabase
    .from("bets")
    .select("bet_type, event:events!event_id(id, external_id, sport, status, metadata, home_score, away_score)")
    .in("status", ["taken", "disputed"])
    .in("bet_type", ["first_scorer", "half_time", "cards_over_under", "first_inning_score", "total_hits_over_under", "first_half_winner"])

  const needsMetaMap = new Map<number, {
    id: number; external_id: string; sport: string; metadata: any
    home_score: number; away_score: number
    needsFirstScorer: boolean; needsHalfTime: boolean; needsCards: boolean
    needsInnings: boolean; needsQuarters: boolean
  }>()

  for (const bet of pendingMetaBets || []) {
    const event = Array.isArray((bet as any).event) ? (bet as any).event[0] : (bet as any).event
    if (!event || event.status !== "finished") continue
    if (!event.external_id?.startsWith("tsdb_")) continue

    const betType = (bet as any).bet_type
    const md = event.metadata?.match_details
    const missingFirstScorer = betType === "first_scorer" && !md?.first_scorer?.team
    const missingHalfTime = betType === "half_time" && md?.halftime_home_score == null
    const missingCards = betType === "cards_over_under" && md?.yellow_cards_total == null
    const missingInnings = (betType === "first_inning_score" || betType === "total_hits_over_under") && md?.first_inning_home == null
    const missingQuarters = betType === "first_half_winner" && md?.half1_home == null

    if (!missingFirstScorer && !missingHalfTime && !missingCards && !missingInnings && !missingQuarters) continue

    const existing = needsMetaMap.get(event.id)
    needsMetaMap.set(event.id, {
      ...event,
      needsFirstScorer: !!(existing?.needsFirstScorer || missingFirstScorer),
      needsHalfTime: !!(existing?.needsHalfTime || missingHalfTime),
      needsCards: !!(existing?.needsCards || missingCards),
      needsInnings: !!(existing?.needsInnings || missingInnings),
      needsQuarters: !!(existing?.needsQuarters || missingQuarters),
    })
  }

  const metaFixedEvents: number[] = []

  for (const ev of needsMetaMap.values()) {
    const idEvent = ev.external_id.replace("tsdb_", "")

    if (ev.sport === "football") {
      try {
        const { data: eventRow } = await supabase.from("events").select("metadata").eq("id", ev.id).single()
        const md = eventRow?.metadata || {}
        const matchDetails = { ...(md.match_details || {}) }
        let updated = false

        const needsTimeline = ev.needsFirstScorer || ev.needsCards
        if (needsTimeline) {
          const timeline = await tsdbEventTimeline(idEvent)
          apiCalls++

          if (ev.needsFirstScorer && ((ev.home_score || 0) + (ev.away_score || 0)) > 0) {
            const firstGoal = extractFirstScorer(timeline)
            if (firstGoal) { matchDetails.first_scorer = firstGoal; updated = true }
          }

          if (ev.needsCards) {
            const cards = extractYellowCards(timeline)
            matchDetails.yellow_cards_home = cards.home
            matchDetails.yellow_cards_away = cards.away
            matchDetails.yellow_cards_total = cards.total
            updated = true
          }
        }

        if (updated) {
          await supabase.from("events").update({ metadata: { ...md, match_details: matchDetails } }).eq("id", ev.id)
          metaFixedEvents.push(ev.id)
        }
      } catch (e: any) {
        apiErrors.push(`meta-fix/${ev.external_id}: ${e.message}`)
      }
    } else if ((ev.sport === "baseball" && ev.needsInnings) || (ev.sport === "basketball" && ev.needsQuarters)) {
      try {
        const raw = await tsdbLookupEvent(idEvent)
        apiCalls++
        if (!raw?.strResult) continue

        const { data: eventRow } = await supabase.from("events").select("metadata").eq("id", ev.id).single()
        const md = eventRow?.metadata || {}
        const matchDetails = { ...(md.match_details || {}) }
        let updated = false

        if (ev.sport === "baseball" && ev.needsInnings) {
          const parsed = parseBaseballInnings(raw.strResult)
          if (parsed) {
            matchDetails.first_inning_home = parsed.homeInnings[0] ?? null
            matchDetails.first_inning_away = parsed.awayInnings[0] ?? null
            matchDetails.total_home_hits = parsed.homeHits
            matchDetails.total_away_hits = parsed.awayHits
            updated = true
          }
        }
        if (ev.sport === "basketball" && ev.needsQuarters) {
          const parsed = parseBasketballQuarters(raw.strResult)
          if (parsed && parsed.homeQuarters.length >= 2 && parsed.awayQuarters.length >= 2) {
            matchDetails.half1_home = parsed.homeQuarters[0] + parsed.homeQuarters[1]
            matchDetails.half1_away = parsed.awayQuarters[0] + parsed.awayQuarters[1]
            updated = true
          }
        }

        if (updated) {
          await supabase.from("events").update({ metadata: { ...md, match_details: matchDetails } }).eq("id", ev.id)
          metaFixedEvents.push(ev.id)
        }
      } catch (e: any) {
        apiErrors.push(`strResult-retry/${ev.external_id}: ${e.message}`)
      }
    }
  }

  // Trigger auto-resolve for meta-fixed events
  for (const eventId of metaFixedEvents) {
    try {
      const res = await fetch(`${baseUrl}/api/admin/bets/auto-resolve-finished`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${CRON_SECRET}` },
        body: JSON.stringify({ event_id: eventId }),
      })
      if (res.ok) resolvedEvents.push(eventId)
      else apiErrors.push(`auto-resolve/meta-fix/event_${eventId}: HTTP ${res.status}`)
    } catch (e: any) {
      apiErrors.push(`auto-resolve/meta-fix/event_${eventId}: ${e.message}`)
    }
  }

  // ── 7. Cancel bets on postponed events & un-feature finished/postponed ──
  for (const eventId of justPostponed) {
    try {
      await cancelBetsForEvent(supabase, eventId)
    } catch (e: any) {
      apiErrors.push(`cancel-postponed/event_${eventId}: ${e.message}`)
    }
  }
  const unfeatureIds = [
    ...justPostponed,
    ...justFinished.map(e => e.id),
  ]
  if (unfeatureIds.length > 0) {
    await supabase.from("events").update({ featured: false }).in("id", unfeatureIds)
  }

  // ── 8. Cleanup expired open bets ─────────────────────────────────────────
  const cleanupResult = await cleanupExpiredOpenBets(supabase, "system")

  console.log("[cron/sync-scores]", {
    updated,
    justFinished: justFinished.length,
    postponed: justPostponed.length,
    metaFixed: metaFixedEvents.length,
    resolvedEvents,
    apiCalls,
    apiErrors,
    cleanup: cleanupResult,
  })

  return NextResponse.json({
    success: true,
    eventsInWindow: eventMap.size,
    updated,
    justFinished: justFinished.length,
    postponed: justPostponed.length,
    metaFixed: metaFixedEvents.length,
    resolvedEvents,
    apiCalls,
    errors: apiErrors,
    cleanup: cleanupResult,
  })
}
