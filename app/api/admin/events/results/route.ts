import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { cleanupExpiredOpenBets } from "@/lib/open-bets-cleanup"
import {
  mapTsdbStatus,
  tsdbLookupEvent,
  tsdbEventTimeline,
  extractFirstScorer,
} from "@/lib/tsdb"

const FORCE_FINISH_AFTER_MS = 4 * 60 * 60 * 1000

function toScore(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

function shouldForceFinished(startTime: string | null | undefined): boolean {
  if (!startTime) return false
  const ms = new Date(startTime).getTime()
  return Number.isFinite(ms) && Date.now() - ms >= FORCE_FINISH_AFTER_MS
}

type EventWithBets = {
  id: number
  external_id: string | null
  sport: string
  home_team: string
  away_team: string
  home_logo: string | null
  away_logo: string | null
  start_time: string
  status: string
  home_score: number | null
  away_score: number | null
  league: string | null
  country: string | null
  total_bets: number
}

// ── GET: list events with active bets ────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  try {
    const { data: bets, error } = await supabase
      .from("bets")
      .select("event_id, status, event:events(id, external_id, sport, home_team, away_team, home_logo, away_logo, start_time, status, home_score, away_score, league, country)")
      .in("status", ["open", "taken", "pending_resolution", "pending_resolution_creator", "pending_resolution_acceptor", "disputed"])
      .order("created_at", { ascending: false })
      .limit(1000)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const byEvent = new Map<number, EventWithBets>()
    const staleEventIds = new Set<number>()
    const nowMs = Date.now()

    for (const row of bets || []) {
      const eventRow = Array.isArray(row.event) ? row.event[0] : row.event
      if (!eventRow?.id) continue

      const current = byEvent.get(eventRow.id)
      if (current) {
        current.total_bets += 1
      } else {
        const eventStatus = (eventRow.status || "").toLowerCase()
        const isStale = (eventStatus === "scheduled" || eventStatus === "live") && shouldForceFinished(eventRow.start_time)
        if (isStale) staleEventIds.add(eventRow.id)

        byEvent.set(eventRow.id, {
          id: eventRow.id,
          external_id: eventRow.external_id,
          sport: eventRow.sport,
          home_team: eventRow.home_team,
          away_team: eventRow.away_team,
          home_logo: eventRow.home_logo ?? null,
          away_logo: eventRow.away_logo ?? null,
          start_time: eventRow.start_time,
          status: isStale ? "finished" : eventRow.status,
          home_score: eventRow.home_score,
          away_score: eventRow.away_score,
          league: eventRow.league,
          country: eventRow.country,
          total_bets: 1,
        })
      }
    }

    if (staleEventIds.size > 0) {
      await supabase.from("events").update({ status: "finished" })
        .in("id", Array.from(staleEventIds))
        .in("status", ["scheduled", "live"])
    }

    const events = Array.from(byEvent.values()).sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    )

    return NextResponse.json({ events })
  } catch (e: unknown) {
    console.error("Admin events results GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ── POST: manually refresh score for one event ───────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  try {
    const body = await request.json()
    const { event_id } = body as { event_id?: number }

    if (!event_id) return NextResponse.json({ error: "event_id is required" }, { status: 400 })

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, external_id, sport, home_team, away_team, start_time, status, home_score, away_score, metadata")
      .eq("id", event_id)
      .single()

    if (eventError || !event) return NextResponse.json({ error: "Event not found" }, { status: 404 })

    const { external_id } = event

    if (!external_id?.startsWith("tsdb_")) {
      return NextResponse.json({ error: "Este evento usa el API antiguo — no se puede actualizar automáticamente" }, { status: 400 })
    }

    const idEvent = external_id.replace("tsdb_", "")
    const raw = await tsdbLookupEvent(idEvent)

    if (!raw) return NextResponse.json({ error: "No se encontró el evento en TheSportsDB" }, { status: 404 })

    const homeScore = toScore(raw.intHomeScore)
    const awayScore = toScore(raw.intAwayScore)
    let newStatus = mapTsdbStatus(raw.strStatus)
    if (shouldForceFinished(event.start_time)) newStatus = "finished"

    const currentMetadata = (event.metadata && typeof event.metadata === "object")
      ? (event.metadata as Record<string, unknown>)
      : {}
    const matchDetails: Record<string, unknown> = {
      ...(currentMetadata.match_details && typeof currentMetadata.match_details === "object"
        ? currentMetadata.match_details as Record<string, unknown>
        : {}),
      updated_at: new Date().toISOString(),
    }

    // Fetch first scorer for finished football events
    if (newStatus === "finished" && event.sport === "football") {
      try {
        const timeline = await tsdbEventTimeline(idEvent)
        const firstGoal = extractFirstScorer(timeline)
        if (firstGoal) matchDetails.first_scorer = firstGoal
      } catch (e: any) {
        console.error("Failed to fetch event timeline:", e.message)
      }
    }

    const nextMetadata = { ...currentMetadata, match_details: matchDetails }

    const { data: updatedEvent, error: updateError } = await supabase
      .from("events")
      .update({ home_score: homeScore, away_score: awayScore, status: newStatus, metadata: nextMetadata })
      .eq("id", event_id)
      .select("id, sport, home_team, away_team, status, home_score, away_score, metadata")
      .single()

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    const cleanupResult = await cleanupExpiredOpenBets(supabase, auth.userId || "system")

    return NextResponse.json({
      success: true,
      event: updatedEvent,
      message: "Marcador consultado y guardado",
      cleanup: cleanupResult,
    })
  } catch (e: unknown) {
    console.error("Admin events results POST error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
