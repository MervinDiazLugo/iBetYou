/**
 * Total payout to the winner: their stake + the opponent's stake.
 * For symmetric bets (multiplier=1): 2 * amount.
 * For exact_score bets: amount * multiplier + amount.
 */
export function calculateTotalPrize(amount: number | string, multiplier: number | string | null | undefined): number {
  const safeMult = Number.isFinite(Number(multiplier)) && Number(multiplier) >= 1 ? Number(multiplier) : 1
  return Number(amount) * safeMult + Number(amount)
}

const PEER_RESOLUTION_BY_TYPE: Record<string, boolean> = {
  direct: true,
  exact_score: true,
  score_margin: true,
  first_scorer: true,
  half_time: true,
}

export function supportsPeerResolution(betType: string | null | undefined) {
  if (!betType) return false
  return PEER_RESOLUTION_BY_TYPE[betType] === true
}

export function getPeerResolutionConfig() {
  return { ...PEER_RESOLUTION_BY_TYPE }
}