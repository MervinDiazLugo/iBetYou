const HOUSE_EDGE = 1.10
const MAX_EXACT_SCORE_ODDS = 150
const BASEBALL_EXACT_SCORE_ODDS = 15.0

// Favorite-longshot bias research (Griffith 1949, Cain/Law/Peel 2000, 70+ studies):
// Bettors at >5x odds lose ~15% vs ~2% at <1.66x. The bias is structural — bettors
// chase longshots regardless of price, so we can cap underdog odds without losing action.
// Cap at 4.0x keeps us in line with William Hill while halving variance from outlier upsets.
const MAX_DIRECT_ODDS = 4.0

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

  const cap = (odds: number) => parseFloat(Math.min(odds, MAX_DIRECT_ODDS).toFixed(4))
  return {
    home: cap(1 / (home * HOUSE_EDGE)),
    away: cap(1 / (away * HOUSE_EDGE)),
    ...(draw !== undefined ? { draw: cap(1 / (draw * HOUSE_EDGE)) } : {}),
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
    // No goal-average data → can't run Poisson model, offer fixed max multiplier
    return MAX_EXACT_SCORE_ODDS
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

// ─── goals_over_under ────────────────────────────────────────────────────────

const GOALS_OVER_UNDER_ODDS: Record<string, number> = {
  "over_0.5": 1.10,  "under_0.5": 7.00,
  "over_1.5": 1.50,  "under_1.5": 2.50,
  "over_2.5": 1.85,  "under_2.5": 1.90,
  "over_3.5": 2.50,  "under_3.5": 1.50,
  "over_4.5": 3.50,  "under_4.5": 1.25,
}

export function calcGoalsOverUnderOdds(selection: string): number | null {
  return GOALS_OVER_UNDER_ODDS[selection] ?? null
}

// ─── both_teams_score ────────────────────────────────────────────────────────

const BOTH_TEAMS_SCORE_ODDS: Record<string, number> = {
  yes: 1.75,
  no:  1.90,
}

export function calcBothTeamsScoreOdds(selection: string): number | null {
  return BOTH_TEAMS_SCORE_ODDS[selection] ?? null
}

// ─── first_inning_score (NRFI/YRFI) ─────────────────────────────────────────
// MLB historical: ~55% NRFI, ~45% YRFI

const FIRST_INNING_SCORE_ODDS: Record<string, number> = {
  nrfi: 1.65,
  yrfi: 2.00,
}

export function calcFirstInningScoreOdds(selection: string): number | null {
  return FIRST_INNING_SCORE_ODDS[selection] ?? null
}

// ─── total_hits_over_under (baseball) ────────────────────────────────────────
// MLB avg ~16-17 combined hits

const TOTAL_HITS_OVER_UNDER_ODDS: Record<string, number> = {
  "over_12.5": 1.25, "under_12.5": 3.50,
  "over_14.5": 1.50, "under_14.5": 2.50,
  "over_16.5": 1.82, "under_16.5": 1.82,
  "over_18.5": 2.50, "under_18.5": 1.50,
  "over_20.5": 3.50, "under_20.5": 1.25,
}

export function calcTotalHitsOverUnderOdds(selection: string): number | null {
  return TOTAL_HITS_OVER_UNDER_ODDS[selection] ?? null
}

// ─── first_half_winner (basketball) ──────────────────────────────────────────

const FIRST_HALF_WINNER_ODDS: Record<string, number> = {
  home:  1.80,
  away:  1.90,
  draw: 12.00,
}

export function calcFirstHalfWinnerOdds(selection: string): number | null {
  return FIRST_HALF_WINNER_ODDS[selection] ?? null
}

// ─── total_points_over_under (basketball) ────────────────────────────────────
// NBA avg ~232 total pts. EuroLeague avg ~155.

const TOTAL_POINTS_NBA_ODDS: Record<string, number> = {
  "over_210.5": 1.30, "under_210.5": 3.20,
  "over_220.5": 1.52, "under_220.5": 2.30,
  "over_230.5": 1.85, "under_230.5": 1.82,
  "over_240.5": 2.30, "under_240.5": 1.52,
  "over_250.5": 3.20, "under_250.5": 1.30,
}

const TOTAL_POINTS_EURO_ODDS: Record<string, number> = {
  "over_140.5": 1.30, "under_140.5": 3.20,
  "over_150.5": 1.52, "under_150.5": 2.30,
  "over_160.5": 1.85, "under_160.5": 1.82,
  "over_170.5": 2.30, "under_170.5": 1.52,
  "over_180.5": 3.20, "under_180.5": 1.30,
}

export function calcTotalPointsOverUnderOdds(selection: string, isNBA: boolean): number | null {
  const table = isNBA ? TOTAL_POINTS_NBA_ODDS : TOTAL_POINTS_EURO_ODDS
  return table[selection] ?? null
}
