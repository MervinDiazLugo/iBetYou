// In-play win probability — pure math, zero AI, zero deps.
// Modular facade: getLiveProbability(). A real live-odds feed can replace the internals later.

export interface LiveState {
  home_score: number
  away_score: number
  progress: string // football: "67"; baseball: "IN8"; basketball: "Q4"/"OT"
  status: string
}
export interface WinProb { home: number; draw?: number; away: number }
export interface Prior { homeGoalsAvg?: number; awayGoalsAvg?: number }

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26)
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp(-z * z / 2)
  const poly = t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  const tail = d * poly // P(X > |z|)
  return z >= 0 ? 1 - tail : tail
}

function footballProb(live: LiveState, prior?: Prior | null): WinProb {
  const minute = Math.min(Number(live.progress) || 0, 90)
  const f = Math.max(0, (90 - minute) / 90)
  const lh = (prior?.homeGoalsAvg && prior.homeGoalsAvg > 0 ? prior.homeGoalsAvg : 1.3) * f
  const la = (prior?.awayGoalsAvg && prior.awayGoalsAvg > 0 ? prior.awayGoalsAvg : 1.3) * f
  const CAP = 8
  let pHome = 0, pDraw = 0, pAway = 0
  for (let x = 0; x <= CAP; x++) {
    for (let y = 0; y <= CAP; y++) {
      const prob = poissonPmf(x, lh) * poissonPmf(y, la)
      const fh = live.home_score + x, fa = live.away_score + y
      if (fh > fa) pHome += prob
      else if (fh < fa) pAway += prob
      else pDraw += prob
    }
  }
  const s = pHome + pDraw + pAway || 1
  return { home: pHome / s, draw: pDraw / s, away: pAway / s }
}

function basketballProb(live: LiveState): WinProb {
  // Remaining fraction from quarter label (4 quarters, ~equal weight; OT ≈ done)
  const q = /Q(\d)/.exec(live.progress || live.status)
  const played = live.status.includes("OT") ? 4 : (q ? Number(q[1]) : 0)
  const f = Math.max(0.02, (4 - played) / 4) // never exactly 0 → keep some variance
  const diff = live.home_score - live.away_score
  const sd = 12 * Math.sqrt(f) + 0.5 // pts SD scales with time left
  const pHome = normCdf(diff / sd)
  return { home: pHome, away: 1 - pHome }
}

// MLB win-expectancy by (run diff, inning) — home team, coarse static logistic model.
function baseballProb(live: LiveState): WinProb {
  const m = /IN(\d+)/.exec(live.progress || live.status)
  const inning = Math.min(m ? Number(m[1]) : 1, 9)
  const diff = live.home_score - live.away_score
  const k = 0.55 + 0.12 * inning // steepens as innings pass
  const pHome = 1 / (1 + Math.exp(-k * diff))
  return { home: pHome, away: 1 - pHome }
}

export function getLiveProbability(
  sport: "football" | "basketball" | "baseball",
  live: LiveState,
  prior?: Prior | null
): WinProb {
  if (sport === "basketball") return basketballProb(live)
  if (sport === "baseball") return baseballProb(live)
  return footballProb(live, prior)
}
