const HOUSE_EDGE = 1.10
const MAX_EXACT_SCORE_ODDS = 150
const BASEBALL_EXACT_SCORE_ODDS = 15.0

export const MAX_DIRECT_EXPOSURE = 500_000
export const MAX_EXACT_EXPOSURE = 200_000

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

const RUN_LINE_ODDS = 1.82

export function calcRunLineOdds(selection: string): number | null {
  if (selection !== "home_rl" && selection !== "away_rl") return null
  return RUN_LINE_ODDS
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

const SCORE_MARGIN_ODDS: Record<string, number> = {
  "1_5":    4.1,
  "6_10":   4.5,
  "11_15":  5.7,
  "16plus": 4.1,
}

export function calcScoreMarginOdds(selection: string): number | null {
  const parts = selection.split("_")
  if (parts.length < 2) return null
  const team = parts[0]
  if (team !== "home" && team !== "away") return null
  const rangeKey = parts.slice(1).join("_")
  return SCORE_MARGIN_ODDS[rangeKey] ?? null
}
