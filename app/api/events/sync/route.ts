import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()
  
  try {
    const body = await request.json()
    const { days = 7 } = body

    let totalEvents = 0

    for (let i = 0; i < days; i++) {
      const date = new Date()
      date.setDate(date.getDate() + i)
      const dateStr = date.toISOString().split('T')[0]

      try {
        const footballRes = await fetch(
          `https://v3.football.api-sports.io/fixtures?date=${dateStr}`,
          { headers: { 'x-apisports-key': API_FOOTBALL_KEY! } }
        )
        const footballData = await footballRes.json()
        
        if (footballData.response) {
          for (const match of footballData.response) {
            const event = match.fixture
            const league = match.league
            const teams = match.teams
            const score = match.score

            const { error: upsertError } = await supabase.from('events').upsert({
              external_id: `football_${event.id}`,
              sport: 'football',
              home_team: teams.home.name,
              away_team: teams.away.name,
              home_logo: teams.home.logo,
              away_logo: teams.away.logo,
              start_time: event.date,
              status: event.status.short === 'FT' ? 'finished' : 
                      event.status.short === 'LIVE' ? 'live' : 'scheduled',
              home_score: score.fulltime.home,
              away_score: score.fulltime.away,
              league: league.name,
              country: league.country,
            }, { onConflict: 'external_id' })

            if (!upsertError) totalEvents++
          }
        }
      } catch (err) {
        console.error('Football sync error:', err)
      }
    }

    return NextResponse.json({ 
      success: true, 
      eventsAdded: totalEvents,
      message: `Sincronizados ${totalEvents} eventos`
    })
  } catch (error) {
    console.error('Sync events error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
