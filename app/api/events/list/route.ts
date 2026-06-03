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
    let query = supabase
      .from('events')
      .select('*')
      .order('featured', { ascending: false, nullsFirst: false })
      .order('start_time', { ascending: true })

    if (featuredOnly) {
      query = query.eq('featured', true)
    } else if (sport && sport !== 'all') {
      query = query.eq('sport', sport)
    }

    if (search) {
      // Avoid breaking Supabase OR syntax if the search contains commas.
      const safeSearch = search.replace(/,/g, ' ')
      query = query.or(`home_team.ilike.%${safeSearch}%,away_team.ilike.%${safeSearch}%`)
    }

    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

    if (status === "all") {
      // no status or time filter — used for league discovery
    } else if (status) {
      query = query.eq('status', status)
      query = query.lte('start_time', thirtyDaysFromNow.toISOString())
    } else {
      // Scheduled: only show events starting within the next 30 days and not yet expired.
      // Live: always show (match in progress regardless of start_time).
      const acceptanceWindowStart = new Date(Date.now() - 10 * 60 * 1000)
      query = query.or(
        `and(status.eq.scheduled,start_time.gte.${acceptanceWindowStart.toISOString()},start_time.lte.${thirtyDaysFromNow.toISOString()}),status.eq.live`
      )
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
      res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120")
      return res
    }

    const { data, error } = await query.limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const res = NextResponse.json(data || [])
    // Featured events change at most 2x/day — cache longer
    const ttl = featuredOnly ? 300 : 60
    res.headers.set("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`)
    return res
  } catch (error) {
    console.error('Get events error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
