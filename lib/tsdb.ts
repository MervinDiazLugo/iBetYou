// TheSportsDB Premium API client
// V1: key in URL path  —  V2: key in X-API-KEY header

const KEY = process.env.THESPORTSDB_API_KEY
const V1 = () => `https://www.thesportsdb.com/api/v1/json/${KEY}`
const V2_BASE = "https://www.thesportsdb.com/api/v2/json"

export async function fetchTsdbV1(path: string): Promise<any> {
  const res = await fetch(`${V1()}${path}`, { cache: "no-store" })
  if (!res.ok) throw new Error(`TSDB V1 ${res.status}: ${path}`)
  return res.json()
}

export async function fetchTsdbV2(path: string): Promise<any> {
  if (!KEY) throw new Error("THESPORTSDB_API_KEY not set")
  const res = await fetch(`${V2_BASE}${path}`, {
    cache: "no-store",
    headers: { "X-API-KEY": KEY },
  })
  if (!res.ok) throw new Error(`TSDB V2 ${res.status}: ${path}`)
  return res.json()
}

// ─── League catalog ─────────────────────────────────────────────────────────

export interface TsdbLeague {
  id: string
  sport: "football" | "basketball" | "baseball"
}

export const TSDB_LEAGUES: TsdbLeague[] = [
  // Soccer — LATAM
  { id: "4406", sport: "football" },  // Argentina Primera División
  { id: "4351", sport: "football" },  // Brazilian Serie A
  { id: "4350", sport: "football" },  // Liga MX
  { id: "4497", sport: "football" },  // Colombian Liga DIMAYOR
  { id: "4627", sport: "football" },  // Chile Primera División
  { id: "4513", sport: "football" },  // Venezuela Primera División
  { id: "4432", sport: "football" },  // Uruguay Primera División
  { id: "4688", sport: "football" },  // Peru Primera División
  { id: "4686", sport: "football" },  // Ecuador Serie A
  { id: "4687", sport: "football" },  // Paraguay Primera División
  { id: "4685", sport: "football" },  // Bolivia Primera División
  // Soccer — Europe (top 5)
  { id: "4328", sport: "football" },  // English Premier League
  { id: "4335", sport: "football" },  // La Liga
  { id: "4332", sport: "football" },  // Serie A
  { id: "4331", sport: "football" },  // Bundesliga
  { id: "4334", sport: "football" },  // Ligue 1
  // Soccer — International
  { id: "4480", sport: "football" },  // UEFA Champions League
  { id: "4524", sport: "football" },  // UEFA Europa League
  { id: "5071", sport: "football" },  // UEFA Conference League
  { id: "4501", sport: "football" },  // Copa Libertadores
  { id: "4724", sport: "football" },  // Copa Sudamericana
  { id: "4499", sport: "football" },  // Copa América
  { id: "4502", sport: "football" },  // UEFA European Championships
  { id: "4429", sport: "football" },  // FIFA World Cup
  // Basketball
  { id: "4387", sport: "basketball" }, // NBA
  { id: "4546", sport: "basketball" }, // EuroLeague Basketball
  { id: "4547", sport: "basketball" }, // EuroCup Basketball
  { id: "4549", sport: "basketball" }, // FIBA Basketball World Cup
  { id: "4850", sport: "basketball" }, // FIBA AmeriCup (Americas)
  { id: "4734", sport: "basketball" }, // Argentine LNB
  // Baseball
  { id: "4424", sport: "baseball" },   // MLB
  { id: "4591", sport: "baseball" },   // NPB (Japan)
  { id: "4830", sport: "baseball" },   // KBO (South Korea)
  { id: "5064", sport: "baseball" },   // Liga Mexicana de Béisbol
  { id: "5112", sport: "baseball" },   // Venezuelan Professional Baseball League
]

// ─── Status mapping ──────────────────────────────────────────────────────────

export function mapTsdbStatus(strStatus: string | null | undefined): "scheduled" | "live" | "finished" | "postponed" {
  if (!strStatus) return "scheduled"
  const s = strStatus.trim().toUpperCase()
  if (["FT", "AET", "PEN", "FT_PEN", "AP", "MATCH FINISHED"].includes(s)) return "finished"
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "Q1", "Q2", "Q3", "Q4", "OT"].includes(s)) return "live"
  if (["POSTP", "CANC", "SUSP", "PST", "ABD", "WO"].includes(s)) return "postponed"
  return "scheduled"
}

// strSport from TheSportsDB → our internal sport value
function mapSport(strSport: string | null | undefined, leagueSport?: "football" | "basketball" | "baseball"): "football" | "basketball" | "baseball" {
  if (leagueSport) return leagueSport
  const s = (strSport || "").toLowerCase()
  if (s === "basketball") return "basketball"
  if (s === "baseball") return "baseball"
  return "football"
}

function toScore(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

// ─── Normalize event row → our DB schema ────────────────────────────────────

function buildStartTime(event: any): string | null {
  const ts: string | null = event.strTimestamp ?? null
  if (ts) {
    const s = ts.trim()
    if (s.includes(" ")) return `${s.replace(" ", "T")}Z`
    if (s.includes("T")) return s.endsWith("Z") ? s : `${s}Z`
    const t: string | null = event.strTime ?? null
    return t ? `${s}T${t}Z` : `${s}T00:00:00Z`
  }
  const d: string | null = event.dateEvent ?? null
  if (d) {
    const t: string | null = event.strTime ?? null
    return t ? `${d}T${t}Z` : `${d}T00:00:00Z`
  }
  return null
}

export function normalizeTsdbEvent(
  event: any,
  leagueSport?: "football" | "basketball" | "baseball"
): Record<string, unknown> | null {
  if (!event?.idEvent || !event.strHomeTeam || !event.strAwayTeam) return null
  const startTime = buildStartTime(event)
  if (!startTime) return null

  const sport = mapSport(event.strSport, leagueSport)

  return {
    external_id: `tsdb_${event.idEvent}`,
    sport,
    league: event.strLeague || "Unknown",
    country: event.strCountry || "Unknown",
    home_team: event.strHomeTeam,
    away_team: event.strAwayTeam,
    home_logo: event.strHomeTeamBadge || null,
    away_logo: event.strAwayTeamBadge || null,
    start_time: startTime,
    status: mapTsdbStatus(event.strStatus),
    home_score: toScore(event.intHomeScore),
    away_score: toScore(event.intAwayScore),
    metadata: {
      venue: { name: event.strVenue || null, city: event.strCity || null },
      tsdb_league_id: event.idLeague,
    },
  }
}

// ─── V2 schedule endpoints ───────────────────────────────────────────────────

/** Next ~15 upcoming events for a league */
export async function tsdbScheduleNext(leagueId: string): Promise<any[]> {
  const data = await fetchTsdbV2(`/schedule/next/league/${leagueId}`)
  return data.schedule || []
}

/** Previous ~15 completed events for a league */
export async function tsdbSchedulePrevious(leagueId: string): Promise<any[]> {
  const data = await fetchTsdbV2(`/schedule/previous/league/${leagueId}`)
  return data.schedule || []
}

// ─── V2 livescore endpoints ──────────────────────────────────────────────────

/** All currently live soccer matches */
export async function tsdbLivescoreSoccer(): Promise<any[]> {
  const data = await fetchTsdbV2("/livescore/soccer")
  return data.livescore || []
}

/** All currently live basketball matches */
export async function tsdbLivescoreBasketball(): Promise<any[]> {
  const data = await fetchTsdbV2("/livescore/basketball")
  return data.livescore || []
}

/** All currently live baseball matches */
export async function tsdbLivescoreBaseball(): Promise<any[]> {
  const data = await fetchTsdbV2("/livescore/baseball")
  return data.livescore || []
}

// ─── V2 event detail & timeline ─────────────────────────────────────────────

/** Timeline events for a match (goals, cards, substitutions) */
export async function tsdbEventTimeline(idEvent: string): Promise<any[]> {
  const data = await fetchTsdbV2(`/lookup/event_timeline/${idEvent}`)
  return data.lookup || []
}

/** Extract first goal scorer from timeline (soccer) */
export function extractFirstScorer(
  timeline: any[]
): { player: string | null; team: string | null; minute: number | null } | null {
  const goals = timeline
    .filter((e) => {
      const type = (e.strTimeline || "").toLowerCase()
      const detail = (e.strTimelineDetail || "").toLowerCase()
      return type === "goal" && !detail.includes("own goal")
    })
    .map((e) => ({
      minute: e.intTime !== null && e.intTime !== undefined ? Number(e.intTime) : null,
      player: e.strPlayer || null,
      team: e.strTeam || null,
    }))
    .filter((e) => e.minute !== null)
    .sort((a, b) => (a.minute as number) - (b.minute as number))

  return goals[0] || null
}

// ─── V1 single-event lookup ──────────────────────────────────────────────────

/** Fetch one event by ID (V1) — used for score refresh fallback */
export async function tsdbLookupEvent(idEvent: string): Promise<any | null> {
  const data = await fetchTsdbV1(`/lookupevent.php?id=${idEvent}`)
  return data.events?.[0] || null
}
