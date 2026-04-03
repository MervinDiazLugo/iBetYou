import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY
const API_FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const API_BASEBALL_URL = process.env.API_BASEBALL_URL || "https://v1.baseball.api-sports.io"

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

function toNullableInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
    return null
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>

    // Baseball and some providers return nested score objects.
    if (record.total !== undefined) return toNullableInt(record.total)
    if (record.points !== undefined) return toNullableInt(record.points)
    if (record.runs !== undefined) return toNullableInt(record.runs)
    if (record.value !== undefined) return toNullableInt(record.value)
  }

  return null
}

function getApiUrl(externalId: string) {
  const [sportPrefix, externalNumericId] = externalId.split("_")

  if (!externalNumericId) return null

  if (sportPrefix === "football") {
    return `${API_FOOTBALL_URL}/fixtures?id=${externalNumericId}`
  }

  if (sportPrefix === "baseball") {
    return `${API_BASEBALL_URL}/games?id=${externalNumericId}`
  }

  return `${API_FOOTBALL_URL}/fixtures?id=${externalNumericId}`
}

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()

  try {
    const { data: bets, error } = await supabase
      .from("bets")
      .select("event_id, status, event:events(id, external_id, sport, home_team, away_team, home_logo, away_logo, start_time, status, home_score, away_score, league, country)")
      .in("status", ["open", "taken", "pending_resolution_creator", "pending_resolution_acceptor", "disputed"])
      .order("created_at", { ascending: false })
      .limit(1000)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const byEvent = new Map<number, EventWithBets>()

    for (const row of bets || []) {
      const eventRow = Array.isArray(row.event) ? row.event[0] : row.event
      if (!eventRow || !eventRow.id) continue

      const current = byEvent.get(eventRow.id)
      if (current) {
        current.total_bets += 1
      } else {
        byEvent.set(eventRow.id, {
          id: eventRow.id,
          external_id: eventRow.external_id,
          sport: eventRow.sport,
          home_team: eventRow.home_team,
          away_team: eventRow.away_team,
          home_logo: eventRow.home_logo ?? null,
          away_logo: eventRow.away_logo ?? null,
          start_time: eventRow.start_time,
          status: eventRow.status,
          home_score: eventRow.home_score,
          away_score: eventRow.away_score,
          league: eventRow.league,
          country: eventRow.country,
          total_bets: 1,
        })
      }
    }

    const events = Array.from(byEvent.values()).sort((a, b) => {
      return new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    })

    return NextResponse.json({ events })
  } catch (error: unknown) {
    console.error("Admin events results GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()

  try {
    const body = await request.json()
    const { event_id } = body as { event_id?: number }

    if (!event_id) {
      return NextResponse.json({ error: "event_id is required" }, { status: 400 })
    }

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, external_id, sport, home_team, away_team, status, home_score, away_score")
      .eq("id", event_id)
      .single()

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 })
    }

    if (!event.external_id) {
      return NextResponse.json({ error: "Event has no external_id" }, { status: 400 })
    }

    const apiUrl = getApiUrl(event.external_id)
    if (!apiUrl) {
      return NextResponse.json({ error: "Invalid external_id format" }, { status: 400 })
    }

    const apiResponse = await fetch(apiUrl, {
      headers: { "x-apisports-key": API_FOOTBALL_KEY! },
      next: { revalidate: 0 },
    })

    if (!apiResponse.ok) {
      return NextResponse.json({ error: "Failed to fetch external API" }, { status: 500 })
    }

    const apiData = await apiResponse.json()
    const fixture = apiData.response?.[0]

    if (!fixture) {
      return NextResponse.json({ error: "No fixture data found" }, { status: 404 })
    }

    const homeScoreRaw = fixture.goals?.home ?? fixture.scores?.home ?? null
    const awayScoreRaw = fixture.goals?.away ?? fixture.scores?.away ?? null
    const homeScore = toNullableInt(homeScoreRaw)
    const awayScore = toNullableInt(awayScoreRaw)

    const newStatus = fixture.fixture?.status?.short === "FT"
      ? "finished"
      : fixture.fixture?.status?.short === "NS"
        ? "scheduled"
        : "live"

    const { data: updatedEvent, error: updateError } = await supabase
      .from("events")
      .update({
        home_score: homeScore,
        away_score: awayScore,
        status: newStatus,
      })
      .eq("id", event_id)
      .select("id, sport, home_team, away_team, status, home_score, away_score")
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      event: updatedEvent,
      score_source: "external_api",
      message: "Marcador consultado y guardado localmente",
    })
  } catch (error: unknown) {
    console.error("Admin events results POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
