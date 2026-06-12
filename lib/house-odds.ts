const HOUSE_EDGE = 1.10
const MAX_EXACT_SCORE_ODDS = 150
const BASEBALL_EXACT_SCORE_ODDS = 15.0

export const MAX_DIRECT_EXPOSURE = 500_000
export const MAX_EXACT_EXPOSURE = 200_000

// Direct bets are blocked when any team's win probability exceeds this threshold.
// Above 80%, underdog odds reach 5.68x+ — too much variance for the house at low sample sizes.
export const MAX_DIRECT_BET_PROBABILITY = 0.80

type PredictionPercent = {
  home: string
  away: string
  draw?: string
}

export type DirectOutcome = "home" | "draw" | "away"

export interface HouseOddsResult {
  home: number
  draw?: number
  away: number
}

function parsePercent(value: string): number {
  return parseFloat(value.replace("%", "")) / 100
}

export function calcDirectOdds(percent: PredictionPercent): HouseOddsResult | null {
  const home = parsePercent(percent.home)
  const away = parsePercent(percent.away)
  const draw = percent.draw !== undefined ? parsePercent(percent.draw) : undefined

  if (!Number.isFinite(home) || !Number.isFinite(away) || home <= 0 || away <= 0) return null
  if (draw !== undefined && !Number.isFinite(draw)) return null

  return {
    home: parseFloat((1 / (home * HOUSE_EDGE)).toFixed(4)),
    away: parseFloat((1 / (away * HOUSE_EDGE)).toFixed(4)),
    ...(draw !== undefined ? { draw: parseFloat((1 / (draw * HOUSE_EDGE)).toFixed(4)) } : {}),
  }
}

export function oddsForOutcome(odds: HouseOddsResult, outcome: DirectOutcome): number | null {
  if (outcome === "home") return odds.home
  if (outcome === "away") return odds.away
  if (outcome === "draw") return odds.draw ?? null
  return null
}

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

function parseScore(selection: string): { home: number; away: number } | null {
  const m = selection.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/)
  if (!m) return null
  return { home: Number(m[1]), away: Number(m[2]) }
}

export function calcExactScoreOdds(
  sport: string,
  selection: string,
  metadata?: Record<string, any>
): number | null {
  if (sport === "basketball") return null

  if (sport === "baseball") return BASEBALL_EXACT_SCORE_ODDS

  const score = parseScore(selection)
  if (!score) return null

  const lambdaHome = parseFloat(metadata?.predictions?.home_goals_avg ?? "0")
  const lambdaAway = parseFloat(metadata?.predictions?.away_goals_avg ?? "0")

  if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway) || lambdaHome <= 0 || lambdaAway <= 0) {
    return null
  }

  const prob = poissonPmf(score.home, lambdaHome) * poissonPmf(score.away, lambdaAway)
  if (!prob || prob <= 0) return MAX_EXACT_SCORE_ODDS

  const odds = 1 / (prob * HOUSE_EDGE)
  return parseFloat(Math.min(odds, MAX_EXACT_SCORE_ODDS).toFixed(2))
}

// ~68% of MLB wins are by 2+ runs (blowout rate)
const BLOWOUT_RATE = 0.68

export function calcRunLineOdds(selection: string, homeWinProb: number): number | null {
  if (selection !== "home_rl" && selection !== "away_rl") return null
  if (!Number.isFinite(homeWinProb) || homeWinProb <= 0 || homeWinProb >= 1) return null
  const pHomeRL = homeWinProb * BLOWOUT_RATE
  const pAwayRL = 1 - pHomeRL
  const prob = selection === "home_rl" ? pHomeRL : pAwayRL
  return parseFloat((1 / (prob * HOUSE_EDGE)).toFixed(2))
}

export function calcRunLineOddsAll(homeWinProb: number): { home_rl: number; away_rl: number } | null {
  const home = calcRunLineOdds("home_rl", homeWinProb)
  const away = calcRunLineOdds("away_rl", homeWinProb)
  if (home === null || away === null) return null
  return { home_rl: home, away_rl: away }
}

const TOTAL_RUNS_ODDS: Record<string, number> = {
  over_7: 1.40,
  under_7: 2.60,
  over_8: 1.65,
  under_8: 2.02,
  over_9: 2.27,
  under_9: 1.52,
  over_10: 3.03,
  under_10: 1.30,
}

export function calcTotalRunsOdds(selection: string): number | null {
  return TOTAL_RUNS_ODDS[selection] ?? null
}

// Probabilities per team per margin (50/50 baseline, conditional on that team winning):
// +1-5: ~33% of wins → ~16.5% overall → fair ~6.1x → with 10% edge: 5.5x
// +6-10: ~28% of wins → ~14% overall → fair ~7.1x → with 10% edge: 6.5x
// +11-15: ~19% of wins → ~9.5% overall → fair ~10.5x → with 10% edge: 9.5x
// +16+: ~20% of wins → ~10% overall → fair ~10.0x → with 10% edge: 9.0x
const SCORE_MARGIN_ODDS: Record<string, number> = {
  "1_5":    5.5,
  "6_10":   6.5,
  "11_15":  9.5,
  "16plus": 9.0,
}

export function calcScoreMarginOdds(selection: string): number | null {
  const parts = selection.split("_")
  if (parts.length < 2) return null
  const team = parts[0]
  if (team !== "home" && team !== "away") return null
  const rangeKey = parts.slice(1).join("_")
  return SCORE_MARGIN_ODDS[rangeKey] ?? null
}
