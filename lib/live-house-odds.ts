// In-play HOUSE odds. Pure module (no cross-module imports) so it unit-tests cleanly.
// Match-winner odds take an already-computed WinProb (caller runs getLiveProbability); this keeps
// the file self-contained and decoupled from the probability model.

export interface WinProbInput { home: number; draw?: number; away: number }
export interface LiveTotalState { home_score: number; away_score: number; progress: string }
export interface GoalsPrior { homeGoalsAvg?: number; awayGoalsAvg?: number }

const HOUSE_EDGE = 1.10
const LIVE_EDGE = 1.05 // extra margin for in-play staleness/variance
const MAX_TEAM_ODDS = 4.0
const MAX_DRAW_ODDS = 150
const MAX_TOTAL_ODDS = 7.0
const MIN_ODDS = 1.02

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}
function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0
  let cum = 0
  for (let i = 0; i <= Math.floor(k); i++) cum += poissonPmf(i, lambda)
  return Math.min(cum, 1)
}
function priceFromProb(p: number, cap: number): number | null {
  if (!Number.isFinite(p) || p <= 0) return null
  const raw = 1 / (p * HOUSE_EDGE * LIVE_EDGE)
  return parseFloat(Math.min(Math.max(raw, MIN_ODDS), cap).toFixed(2))
}

export function matchWinnerOddsFromProb(wp: WinProbInput, selection: string): number | null {
  const p = selection === "home" ? wp.home : selection === "away" ? wp.away : selection === "draw" ? wp.draw : undefined
  if (p === undefined) return null
  const cap = selection === "draw" ? MAX_DRAW_ODDS : MAX_TEAM_ODDS
  return priceFromProb(p, cap)
}

export function calcLiveTotalOuOdds(
  live: LiveTotalState,
  prior: GoalsPrior | null | undefined,
  selection: string
): number | null {
  const m = selection.match(/^(over|under)_(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const dir = m[1]
  const line = parseFloat(m[2])
  const minute = Math.min(Number(live.progress) || 0, 90)
  const f = Math.max(0, (90 - minute) / 90)
  const lh = prior?.homeGoalsAvg && prior.homeGoalsAvg > 0 ? prior.homeGoalsAvg : 1.3
  const la = prior?.awayGoalsAvg && prior.awayGoalsAvg > 0 ? prior.awayGoalsAvg : 1.3
  const lambdaRem = (lh + la) * f
  const tcur = live.home_score + live.away_score
  // final = tcur + K, K ~ Poisson(lambdaRem). P(final > line) = P(K > line - tcur)
  const need = line - tcur
  const pOver = need < 0 ? 1 : 1 - poissonCdf(Math.floor(need), lambdaRem)
  const p = dir === "over" ? pOver : 1 - pOver
  return priceFromProb(p, MAX_TOTAL_ODDS)
}
