import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const supabase = createAdminSupabaseClient()
  const searchParams = request.nextUrl.searchParams
  const sport = searchParams.get("sport")
  const status = searchParams.get("status")
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
      .order('featured', { ascending: false })
      .order('start_time', { ascending: true })

    if (sport && sport !== 'all') {
      query = query.eq('sport', sport)
    }

    if (search) {
      // Avoid breaking Supabase OR syntax if the search contains commas.
      const safeSearch = search.replace(/,/g, ' ')
      query = query.or(`home_team.ilike.%${safeSearch}%,away_team.ilike.%${safeSearch}%`)
    }

    if (status) {
      query = query.eq('status', status)
    } else {
      // Default: include upcoming and just-started events to avoid timezone/status gaps.
      const acceptanceWindowStart = new Date(Date.now() - 10 * 60 * 1000)
      query = query.in('status', ['scheduled', 'live'])
      query = query.gte('start_time', acceptanceWindowStart.toISOString())
    }

    // Limit to next 30 days
    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
    query = query.lte('start_time', thirtyDaysFromNow.toISOString())

    if (paginated) {
      const { data, error } = await query.range(offset, offset + limit)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const rows = data || []
      const hasMore = rows.length > limit
      const events = hasMore ? rows.slice(0, limit) : rows

      return NextResponse.json({ events, hasMore })
    }

    const { data, error } = await query.limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Get events error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
