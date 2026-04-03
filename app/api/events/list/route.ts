import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const supabase = createAdminSupabaseClient()
  const searchParams = request.nextUrl.searchParams
  const sport = searchParams.get("sport")
  const status = searchParams.get("status")

  try {
    let query = supabase
      .from('events')
      .select('*')
      .order('start_time', { ascending: true })

    if (sport && sport !== 'all') {
      query = query.eq('sport', sport)
    }

    if (status) {
      query = query.eq('status', status)
    } else {
      // Default: show scheduled events within a rolling window starting at UTC day start.
      // This avoids empty lists for leagues whose "scheduled" games are earlier in the same UTC day.
      const startOfUtcDay = new Date()
      startOfUtcDay.setUTCHours(0, 0, 0, 0)

      query = query.eq('status', 'scheduled')
      query = query.gte('start_time', startOfUtcDay.toISOString())
    }

    // Limit to next 30 days
    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
    query = query.lte('start_time', thirtyDaysFromNow.toISOString())

    const { data, error } = await query.limit(50)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Get events error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
