import { NextRequest, NextResponse } from "next/server"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { TSDB_LEAGUES, tsdbScheduleNext, tsdbSchedulePrevious, mapTsdbStatus } from "@/lib/tsdb"

// Returns events in a format compatible with the backoffice browser.
// Each event has an `external_id` field (tsdb_{id}) plus a fixture-like shape
// that the page's handleSaveSelected already uses.

function mapSport(sport: string): "football" | "basketball" | "baseball" {
  if (sport === "basketball") return "basketball"
  if (sport === "baseball") return "baseball"
  return "football"
}

function toScore(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

function mapStatusShort(strStatus: string | null | undefined): string {
  if (!strStatus) return "NS"
  const s = strStatus.trim().toUpperCase()
  if (["FT", "AET", "PEN", "FT_PEN", "AP"].includes(s)) return "FT"
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "Q1", "Q2", "Q3", "Q4", "OT"].includes(s)) return "IN"
  if (["POSTP", "CANC", "SUSP", "PST", "ABD"].includes(s)) return "POSTP"
  return "NS"
}

// Convert TheSportsDB event to ExternalEvent-compatible shape
function toExternalEvent(raw: any, sport: "football" | "basketball" | "baseball") {
  return {
    // The real external_id to be used when saving
    external_id: `tsdb_${raw.idEvent}`,
    sport,
    fixture: {
      id: Number(raw.idEvent),
      date: raw.strTimestamp ? `${raw.strTimestamp}Z` : raw.dateEvent,
      status: {
        short: mapStatusShort(raw.strStatus),
        long: raw.strStatus || "Not Started",
      },
      venue: { name: raw.strVenue || null, city: raw.strCity || null },
    },
    league: {
      name: raw.strLeague || "Unknown",
      country: raw.strCountry || "Unknown",
      logo: raw.strLeagueBadge || null,
    },
    teams: {
      home: { name: raw.strHomeTeam, logo: raw.strHomeTeamBadge || null },
      away: { name: raw.strAwayTeam, logo: raw.strAwayTeamBadge || null },
    },
    score: {
      fulltime: {
        home: toScore(raw.intHomeScore),
        away: toScore(raw.intAwayScore),
      },
    },
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  if (!process.env.THESPORTSDB_API_KEY) {
    return NextResponse.json({ error: "THESPORTSDB_API_KEY not configured" }, { status: 500 })
  }

  const searchParams = request.nextUrl.searchParams
  const sport = searchParams.get("sport") || "football"
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  const fromMs = from ? new Date(from).getTime() : Date.now()
  const toMs = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 : Date.now() + 7 * 24 * 60 * 60 * 1000

  // Select leagues matching the requested sport
  const targetSport = mapSport(sport)
  const leaguesToFetch = TSDB_LEAGUES.filter((l) => l.sport === targetSport)

  const allEvents: any[] = []
  const errors: Array<{ league: string; error: string }> = []

  // Fetch upcoming + recent past events for each league
  await Promise.all(
    leaguesToFetch.map(async (league) => {
      try {
        const [next, prev] = await Promise.all([
          tsdbScheduleNext(league.id).catch(() => []),
          tsdbSchedulePrevious(league.id).catch(() => []),
        ])

        for (const raw of [...next, ...prev]) {
          if (!raw.strTimestamp || !raw.strHomeTeam || !raw.strAwayTeam) continue
          const dateMs = new Date(`${raw.strTimestamp}Z`).getTime()
          if (dateMs < fromMs || dateMs > toMs) continue
          allEvents.push(toExternalEvent(raw, targetSport))
        }
      } catch (e: any) {
        errors.push({ league: league.id, error: e.message })
      }
    })
  )

  // Deduplicate by idEvent
  const seen = new Set<string>()
  const deduplicated = allEvents.filter((e) => {
    const key = e.external_id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Sort by date
  deduplicated.sort((a, b) =>
    new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime()
  )

  if (deduplicated.length === 0 && errors.length > 0) {
    return NextResponse.json(
      { error: `No se obtuvieron eventos`, details: errors },
      { status: 502 }
    )
  }

  return NextResponse.json(deduplicated)
}
