// Script to sync events from API-Football
// Run: npx tsx scripts/sync-events.ts

const API_KEY = process.env.API_FOOTBALL_KEY
const API_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"

const LEAGUES = {
  football: [
    { id: 39, name: "Premier League", country: "England" },
    { id: 140, name: "La Liga", country: "Spain" },
    { id: 135, name: "Serie A", country: "Italy" },
    { id: 61, name: "Ligue 1", country: "France" },
    { id: 78, name: "Bundesliga", country: "Germany" },
    { id: 71, name: "Brasileirão", country: "Brazil" },
  ],
  basketball: [
    { id: 12, name: "NBA", country: "USA" },
  ],
  baseball: [
    { id: 1, name: "MLB", country: "USA" },
  ],
}

async function fetchEvents(sport: string, leagueId: number, season: string = "2024") {
  const endpoint = sport === "football" 
    ? `${API_URL}/competitions/${leagueId}/matches?season=${season}&status=SCHEDULED`
    : sport === "basketball"
    ? `${API_URL}/games?league=${leagueId}&season=${season}&status=NS`
    : `${API_URL}/games?league=${leagueId}&season=${season}&status=NS`

  console.log(`Fetching ${sport} league ${leagueId}...`)
  
  try {
    const response = await fetch(endpoint, {
      headers: { "x-apisports-key": API_KEY! },
    })
    
    if (!response.ok) {
      console.error(`Error: ${response.status}`)
      return []
    }
    
    const data = await response.json()
    return data.response || []
  } catch (error) {
    console.error(`Fetch error:`, error)
    return []
  }
}

async function syncToDatabase(events: any[]) {
  console.log(`Processing ${events.length} events...`)
  // This would insert to Supabase
  // For now, just log
}

async function main() {
  console.log("Starting event sync...")
  
  // Sync football
  for (const league of LEAGUES.football) {
    const events = await fetchEvents("football", league.id)
    console.log(`Found ${events.length} football matches for ${league.name}`)
  }
  
  console.log("Sync complete!")
}

main().catch(console.error)
