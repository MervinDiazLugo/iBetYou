import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY
const API_FOOTBALL_URL = process.env.API_FOOTBALL_URL

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get("sport") || "all"

  try {
    // Paginate through all rows (Supabase caps at 1000 per request by default)
    const PAGE_SIZE = 1000
    let allData: Record<string, unknown>[] = []
    let from = 0

    while (true) {
      let query = supabase
        .from("events")
        .select("*")
        .order("start_time", { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (sport !== "all") {
        query = query.eq("sport", sport)
      }

      const { data, error } = await query
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data || data.length === 0) break

      allData = allData.concat(data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    return NextResponse.json({ events: allData })
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

      const response = await fetch(
        `${API_FOOTBALL_URL}/fixtures?date=${new Date().toISOString().split("T")[0]}`,
        { headers: { "x-apisports-key": API_FOOTBALL_KEY } }
      )

      if (!response.ok) {
        return NextResponse.json({ error: "Failed to fetch from external API" }, { status: 500 })
      }

      const data = await response.json()
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

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error: unknown) {
    console.error("Admin events POST error:", error)
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
  const externalIds = events.map((e) => e.external_id).filter(Boolean)

  const { data: existing, error: fetchError } = await supabase
    .from("events")
    .select("id, external_id")
    .in("external_id", externalIds)

  if (fetchError) return { count: 0, error: fetchError.message }

  const existingMap = new Map(
    (existing || []).map((e: { id: number; external_id: string }) => [e.external_id, e.id])
  )

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
