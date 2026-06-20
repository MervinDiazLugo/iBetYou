const HOUSE_EDGE = 1.10
const MAX_EXACT_SCORE_ODDS = 150
const BASEBALL_EXACT_SCORE_ODDS = 15.0

// Favorite-longshot bias (Griffith 1949, Cain/Law/Peel 2000, 70+ studies):
// Bettors at >5x odds lose ~15% vs ~2% at <1.66x — they chase longshots regardless of price.
// Cap HOME/AWAY at 4.0x: reduces variance on upset wins without losing underdog action.
// DRAW is NOT capped: research shows bettors underestimate draw probability (opposite bias),
// so draws are already margin-friendly; artificially capping them would be too visible.
const MAX_TEAM_ODDS = 4.0

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

  const capTeam = (odds: number) => parseFloat(Math.min(odds, MAX_TEAM_ODDS).toFixed(4))
  const raw = (odds: number) => parseFloat(odds.toFixed(4))
  return {
    home: capTeam(1 / (home * HOUSE_EDGE)),
    away: capTeam(1 / (away * HOUSE_EDGE)),
    ...(draw !== undefined ? { draw: raw(1 / (draw * HOUSE_EDGE)) } : {}),
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

// P(X ≤ k) for Poisson(lambda) — used for over/under goal lines
function poissonCdf(k: number, lambda: number): number {
  let cum = 0
  for (let i = 0; i <= Math.floor(k); i++) cum += poissonPmf(i, lambda)
  return Math.min(cum, 1)
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
// Dynamic Poisson model: same approach as exact_score.
// Average European+LATAM leagues: λ ≈ 2.6 total goals/game.
// Using game-specific λ from metadata.predictions.home/away_goals_avg when available.
// The original fixed table had MULTIPLE lines with negative house EV:
//   over_1.5 @ 1.50x: true P≈73% → house EV -10%;  under_3.5 @ 1.50x: true P≈74% → -10%
//   under_4.5 @ 1.25x: true P≈87% → -8%;  over_0.5 @ 1.10x: true P≈93% → -2%
const GOALS_OU_LAMBDA_DEFAULT = 2.6
const MAX_GOALS_OU_ODDS = 7.0

export function calcGoalsOverUnderOdds(
  selection: string,
  metadata?: Record<string, any> | null
): number | null {
  const m = selection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const direction = m[1] as "over" | "under"
  const threshold = parseFloat(m[2])
  if (!Number.isFinite(threshold)) return null

  const lh = parseFloat(metadata?.predictions?.home_goals_avg ?? "0")
  const la = parseFloat(metadata?.predictions?.away_goals_avg ?? "0")
  const lambda = lh > 0 && la > 0 ? lh + la : GOALS_OU_LAMBDA_DEFAULT

  // e.g. "over_2.5": P(total > 2.5) = P(total ≥ 3) = 1 - Poisson CDF at k=2
  const pUnder = poissonCdf(Math.floor(threshold), lambda)
  const pOver = 1 - pUnder
  const prob = direction === "over" ? pOver : pUnder
  if (prob <= 0.005) return null

  const raw = 1 / (prob * HOUSE_EDGE)
  return parseFloat(Math.min(Math.max(raw, 1.02), MAX_GOALS_OU_ODDS).toFixed(2))
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
// MLB 5-season average (Baseball-Reference 2019-2024): ~16.4 combined hits/game, SD≈3.5
// Original symmetric table (1.25/3.50 at extremes) was badly wrong:
//   over_12.5 @ 1.25x: true P≈87% → house EV -8%
//   over_14.5 @ 1.50x: true P≈71% → house EV -6%
// Fixed with Normal(16.4, 3.5) distribution → 10% HOUSE_EDGE per selection.

const TOTAL_HITS_OVER_UNDER_ODDS: Record<string, number> = {
  // P≈86.7% → raw=1.048, floored to 1.05
  "over_12.5": 1.05,
  // P≈13.3% → 1/(0.133×1.10)=6.83, capped at 5.0
  "under_12.5": 5.00,
  // P≈70.7% → 1/(0.707×1.10)=1.29
  "over_14.5": 1.29,
  // P≈29.3% → 1/(0.293×1.10)=3.10
  "under_14.5": 3.10,
  // P≈48.8% → 1/(0.488×1.10)=1.87
  "over_16.5": 1.87,
  // P≈51.2% → 1/(0.512×1.10)=1.78
  "under_16.5": 1.78,
  // P≈27.4% → 1/(0.274×1.10)=3.32
  "over_18.5": 3.32,
  // P≈72.6% → 1/(0.726×1.10)=1.25
  "under_18.5": 1.25,
  // P≈12.1% → raw=7.51, capped at 5.0
  "over_20.5": 5.00,
  // P≈87.9% → raw=1.03, floored to 1.05
  "under_20.5": 1.05,
}

export function calcTotalHitsOverUnderOdds(selection: string): number | null {
  return TOTAL_HITS_OVER_UNDER_ODDS[selection] ?? null
}

// ─── first_half_winner (basketball) ──────────────────────────────────────────
// NBA halftime data (Basketball-Reference 2019-2024, 5-season average):
//   Home leads at half: ~55% | Away leads: ~34% | Tied: ~11%
// Previous table (1.80/1.90/12.00) implied 55.6%/52.6%/8.3% — away was GROSSLY
// overpriced (52.6% implied vs 34% real → house lost ~18% on away halftime bets).
// Corrected with 10% house edge: home=1/(0.55×1.10), away=1/(0.34×1.10), draw=1/(0.11×1.10)
const FIRST_HALF_WINNER_ODDS: Record<string, number> = {
  home: 1.65,  // implied 60.6% vs true 55% → +10% edge
  away: 2.67,  // implied 37.5% vs true 34% → +10% edge
  draw: 8.25,  // implied 12.1% vs true 11% → +10% edge
}

export function calcFirstHalfWinnerOdds(selection: string): number | null {
  return FIRST_HALF_WINNER_ODDS[selection] ?? null
}

// ─── total_points_over_under (basketball) ────────────────────────────────────
// Calibrated from Normal distribution: NBA mean=232 pts, SD=22; EuroLeague mean=157, SD=17
// (5-season averages from NBA.com and EuroLeague stats, 2019-2024)
// Original table was symmetric (mirror image) — wrong. Over_210.5 is ~83% likely in NBA,
// so offering 1.30x (77% implied) → house lost ~9% on those bets.
// Fixed with Normal CDF → 10% HOUSE_EDGE applied per selection.

const TOTAL_POINTS_NBA_ODDS: Record<string, number> = {
  // P≈83.5% → raw=1.09, floored to 1.10 (min offering)
  "over_210.5": 1.10,
  // P≈16.5% → raw=5.51, capped at MAX_TEAM_ODDS=4.0
  "under_210.5": 4.00,
  // P≈69.5% → 1/(0.695×1.10)=1.31
  "over_220.5": 1.31,
  // P≈30.5% → 1/(0.305×1.10)=2.98
  "under_220.5": 2.98,
  // P≈52.7% → 1/(0.527×1.10)=1.72
  "over_230.5": 1.72,
  // P≈47.3% → 1/(0.473×1.10)=1.92
  "under_230.5": 1.92,
  // P≈35.0% → 1/(0.350×1.10)=2.60
  "over_240.5": 2.60,
  // P≈65.0% → 1/(0.650×1.10)=1.40
  "under_240.5": 1.40,
  // P≈20.0% → raw=4.55, capped at 4.0
  "over_250.5": 4.00,
  // P≈80.0% → 1/(0.800×1.10)=1.14
  "under_250.5": 1.14,
}

const TOTAL_POINTS_EURO_ODDS: Record<string, number> = {
  // EuroLeague mean=157, SD=17
  // P≈83.4% → floored to 1.10
  "over_140.5": 1.10,
  // P≈16.6% → capped at 4.0
  "under_140.5": 4.00,
  // P≈64.9% → 1/(0.649×1.10)=1.40
  "over_150.5": 1.40,
  // P≈35.1% → 1/(0.351×1.10)=2.59
  "under_150.5": 2.59,
  // P≈41.8% → 1/(0.418×1.10)=2.18
  "over_160.5": 2.18,
  // P≈58.2% → 1/(0.582×1.10)=1.56
  "under_160.5": 1.56,
  // P≈21.4% → raw=4.25, capped at 4.0
  "over_170.5": 4.00,
  // P≈78.6% → 1/(0.786×1.10)=1.16
  "under_170.5": 1.16,
  // P≈8.3% → capped at 4.0 (remote outcome, controlled exposure)
  "over_180.5": 4.00,
  // P≈91.7% → floored to 1.05
  "under_180.5": 1.05,
}

export function calcTotalPointsOverUnderOdds(selection: string, isNBA: boolean): number | null {
  const table = isNBA ? TOTAL_POINTS_NBA_ODDS : TOTAL_POINTS_EURO_ODDS
  return table[selection] ?? null
}
