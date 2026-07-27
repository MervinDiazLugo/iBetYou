export interface SettleCtx {
  cur: { home: number; away: number }       // marcador actual
  baseline: { home: number; away: number }  // marcador al crear la apuesta
  finished: boolean
}
export type SettleResult =
  | { status: "pending" }
  | { status: "void" }
  | { status: "resolved"; winner: "creator" | "acceptor" }

function outcome(creatorSelection: string, winningSelection: string): SettleResult {
  return { status: "resolved", winner: creatorSelection === winningSelection ? "creator" : "acceptor" }
}

export function settleLiveBet(betType: string, creatorSelection: string, ctx: SettleCtx): SettleResult {
  const { cur, baseline, finished } = ctx
  const totalCur = cur.home + cur.away
  const totalBase = baseline.home + baseline.away

  if (betType === "live_more_scoring") {
    if (totalCur > totalBase) return outcome(creatorSelection, "yes")
    if (finished) return outcome(creatorSelection, "no")
    return { status: "pending" }
  }

  if (betType === "live_next_team_scores") {
    const dh = cur.home - baseline.home
    const da = cur.away - baseline.away
    if (dh > 0 && da > 0) return { status: "void" }
    if (dh > 0) return outcome(creatorSelection, "home")
    if (da > 0) return outcome(creatorSelection, "away")
    if (finished) return { status: "void" }
    return { status: "pending" }
  }

  return { status: "pending" }
}
