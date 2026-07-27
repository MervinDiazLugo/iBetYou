export const LIVE_P2P_BET_TYPES = ["live_more_scoring", "live_next_team_scores"] as const
export type LiveP2PBetType = (typeof LIVE_P2P_BET_TYPES)[number]

export function isLiveP2PBetType(t: string): t is LiveP2PBetType {
  return (LIVE_P2P_BET_TYPES as readonly string[]).includes(t)
}

// Scoring noun per sport, for labels.
export function scoringNoun(sport: string): string {
  if (sport === "basketball") return "puntos"
  if (sport === "baseball") return "carreras"
  return "goles"
}
