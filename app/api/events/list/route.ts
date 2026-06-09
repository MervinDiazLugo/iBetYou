import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const supabase = createAdminSupabaseClient()
  const searchParams = request.nextUrl.searchParams
  const sport = searchParams.get("sport")
  const status = searchParams.get("status")
  const featuredOnly = searchParams.get("featured") === "true"
  const paginated = searchParams.get("paginated") === "1"
  const rawLimit = Number(searchParams.get("limit") || "50")
  const rawOffset = Number(searchParams.get("offset") || "0")
  const search = (searchParams.get("search") || "").trim()

  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 50
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0

  try {
    // Check demo mode — when active, only return demo events
    const { data: demoSetting } = await supabase
      .from("app_settings").select("value").eq("key", "demo_mode").maybeSingle()
    const demoActive = (demoSetting?.value as any)?.active === true

    let query = supabase
      .from('events')
      .select('*')
      .order('featured', { ascending: false, nullsFirst: false })
      .order('start_time', { ascending: true })

    if (demoActive && status !== "all") {
      // Demo mode: only demo events
      query = query.eq('is_demo', true)
    } else if (featuredOnly) {
      query = query.eq('featured', true)
    } else if (sport && sport !== 'all') {
      query = query.eq('sport', sport)
    }

    if (search) {
      const safeSearch = search.replace(/,/g, ' ')
      query = query.or(`home_team.ilike.%${safeSearch}%,away_team.ilike.%${safeSearch}%`)
    }

    const now = new Date()
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    // Live events older than 24h are stuck — don't show them
    const liveMaxAge = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    // Scheduled acceptance window: up to 10 min after start_time
    const acceptanceWindowStart = new Date(now.getTime() - 10 * 60 * 1000)

    if (demoActive && status !== "all") {
      // Demo mode: show demo events regardless of start_time or status
      // (synthetic results are generated daily regardless of actual match time)
    } else if (status === "all") {
      // no status or time filter — used for league discovery
    } else if (status) {
      query = query.eq('status', status)
      query = query.lte('start_time', thirtyDaysFromNow.toISOString())
    } else {
      // Never show finished/cancelled/postponed events in the marketplace.
      // Scheduled: start_time within acceptance window and next 30 days.
      // Live: capped at 24h to avoid stuck "live" events from days ago.
      query = query.or(
        `and(status.eq.scheduled,start_time.gte.${acceptanceWindowStart.toISOString()},start_time.lte.${thirtyDaysFromNow.toISOString()}),` +
        `and(status.eq.live,start_time.gte.${liveMaxAge.toISOString()})`
      )
    }

    // Always exclude finished/cancelled/postponed unless status=all or demo mode
    if (status !== "all" && !demoActive) {
      query = query.not('status', 'in', '("finished","cancelled","postponed")')
    }

    if (paginated) {
      const { data, error } = await query.range(offset, offset + limit)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const rows = data || []
      const hasMore = rows.length > limit
      const events = hasMore ? rows.slice(0, limit) : rows

      const res = NextResponse.json({ events, hasMore })
      if (!demoActive) res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120")
      return res
    }

    const { data, error } = await query.limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const res = NextResponse.json(data || [])
    if (!demoActive) {
      const ttl = featuredOnly ? 300 : 60
      res.headers.set("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`)
    }
    return res
  } catch (error) {
    console.error('Get events error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
