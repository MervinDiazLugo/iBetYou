import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY
const API_FOOTBALL_URL = process.env.API_FOOTBALL_URL

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  
  const sport = searchParams.get('sport') || 'all'
  const limit = parseInt(searchParams.get('limit') || '200')

  try {
    let query = supabase.from('events').select('*')
    
    if (sport && sport !== 'all') {
      query = query.eq('sport', sport)
    }
    
    query = query.order('start_time', { ascending: true }).limit(limit)
    
    const { data, error } = await query
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ events: data })
  } catch (error: unknown) {
    console.error('Admin events error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
    const { action, sport, league, home_team, away_team, start_time, country } = body

    if (action === 'sync') {
      // Fetch from external API
      if (!API_FOOTBALL_KEY || !API_FOOTBALL_URL) {
        return NextResponse.json({ error: 'API not configured' }, { status: 500 })
      }

      const response = await fetch(`${API_FOOTBALL_URL}/fixtures?date=${new Date().toISOString().split('T')[0]}`, {
        headers: {
          'x-apisports-key': API_FOOTBALL_KEY
        }
      })

      if (!response.ok) {
        return NextResponse.json({ error: 'Failed to fetch from external API' }, { status: 500 })
      }

      const data = await response.json()
      
      if (!data.response || data.response.length === 0) {
        return NextResponse.json({ message: 'No events found', events: [] })
      }

      // Process and insert events one by one
      interface ApiFixture {
        league: { name: string; country?: string }
        teams: { home: { name: string; logo: string }; away: { name: string; logo: string } }
        fixture: { id: number; date: string }
      }
      const events = (data.response as ApiFixture[]).map((fixture) => ({
        sport: 'football',
        league: fixture.league.name,
        country: fixture.league.country || 'Unknown',
        home_team: fixture.teams.home.name,
        away_team: fixture.teams.away.name,
        home_logo: fixture.teams.home.logo,
        away_logo: fixture.teams.away.logo,
        start_time: fixture.fixture.date,
        status: 'scheduled',
        external_id: `football_${fixture.fixture.id}`
      }))

      let inserted = 0
      
      for (const event of events) {
        // Check if exists
        const { data: existing } = await supabase
          .from('events')
          .select('id')
          .eq('external_id', event.external_id)
          .single()

        if (existing) {
          await supabase.from('events').update(event).eq('id', existing.id)
        } else {
          await supabase.from('events').insert(event)
        }
        inserted++
      }

      return NextResponse.json({ success: true, count: inserted })
    }

    if (action === 'create') {
      if (!home_team || !away_team || !start_time) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
      }

      const { data: event, error } = await supabase
        .from('events')
        .insert({
          sport: sport || 'football',
          league: league || 'Friendly',
          country: country || 'Unknown',
          home_team,
          away_team,
          start_time,
          status: 'scheduled'
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, event })
    }

    if (action === 'bulk_create') {
      const { events } = body

      if (!events || !Array.isArray(events) || events.length === 0) {
        return NextResponse.json({ error: 'No events to insert' }, { status: 400 })
      }

      const inserted: Record<string, unknown>[] = []
      
      for (const event of events) {
        // Check if event exists by external_id
        const { data: existing } = await supabase
          .from('events')
          .select('id')
          .eq('external_id', event.external_id)
          .single()

        if (existing) {
          // Update existing event
          const { data: updated } = await supabase
            .from('events')
            .update(event)
            .eq('id', existing.id)
            .select()
            .single()
          
          if (updated) inserted.push(updated)
        } else {
          // Insert new event
          const { data: newEvent } = await supabase
            .from('events')
            .insert(event)
            .select()
            .single()
          
          if (newEvent) inserted.push(newEvent)
        }
      }

      return NextResponse.json({ success: true, events: inserted, count: inserted.length })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('Admin events error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })
  }

  try {
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', parseInt(id))

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Admin delete event error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
