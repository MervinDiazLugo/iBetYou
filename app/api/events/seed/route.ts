import { NextRequest, NextResponse } from "next/server"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  try {
    const events = [
      {
        external_id: "test_1",
        sport: "football",
        home_team: "Argentina",
        away_team: "Brasil",
        start_time: "2026-03-28T20:00:00Z",
        status: "scheduled",
        league: "Copa America",
        country: "Argentina"
      },
      {
        external_id: "test_2", 
        sport: "football",
        home_team: "Colombia",
        away_team: "Uruguay",
        start_time: "2026-03-25T20:00:00Z",
        status: "scheduled",
        league: "Eliminatorias",
        country: "Colombia"
      },
      {
        external_id: "test_3",
        sport: "football",
        home_team: "España",
        away_team: "Francia",
        start_time: "2026-03-26T20:00:00Z",
        status: "scheduled",
        league: "Amistoso",
        country: "España"
      },
      {
        external_id: "test_4",
        sport: "football",
        home_team: "Alemania",
        away_team: "Italia",
        start_time: "2026-03-27T20:00:00Z",
        status: "scheduled",
        league: "Amistoso",
        country: "Alemania"
      }
    ]

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    for (const event of events) {
      const res = await fetch(`${supabaseUrl}/rest/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(event)
      })
      
      if (!res.ok) {
        const error = await res.text()
        console.error('Insert error:', error)
      }
    }

    return NextResponse.json({ success: true, eventsAdded: events.length })
  } catch (error) {
    console.error('Seed events error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
