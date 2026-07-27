import { test } from "node:test"
import assert from "node:assert/strict"
import { matchWinnerOddsFromProb, calcLiveTotalOuOdds } from "./live-house-odds.ts"

test("winner: prob alta (favorito) → cuota baja con margen", () => {
  const o = matchWinnerOddsFromProb({ home: 0.9, draw: 0.06, away: 0.04 }, "home")!
  assert.ok(o >= 1.02 && o < 1.2, `cuota local ${o}`)
})
test("winner: prob baja → cuota alta capada a 4.0", () => {
  const o = matchWinnerOddsFromProb({ home: 0.9, draw: 0.06, away: 0.04 }, "away")!
  assert.equal(o, 4.0)
})
test("winner: draw usa cap alto (150), no 4.0", () => {
  const o = matchWinnerOddsFromProb({ home: 0.9, draw: 0.001, away: 0.099 }, "draw")!
  assert.ok(o > 4.0, `draw ${o}`)
})
test("winner: selección sin prob (draw en 2-way) → null", () => {
  const o = matchWinnerOddsFromProb({ home: 0.6, away: 0.4 }, "draw")
  assert.equal(o, null)
})
test("total: 3 goles, over_2.5 ya superado → piso ~1.02", () => {
  const o = calcLiveTotalOuOdds({ home_score: 2, away_score: 1, progress: "70" }, { homeGoalsAvg: 1.3, awayGoalsAvg: 1.3 }, "over_2.5")!
  assert.ok(o >= 1.02 && o < 1.2, `over ${o}`)
})
test("total: 3 goles, under_2.5 imposible → null", () => {
  const o = calcLiveTotalOuOdds({ home_score: 2, away_score: 1, progress: "70" }, null, "under_2.5")
  assert.equal(o, null)
})
test("total: 0-0 min 10, over_2.5 incierto → cuota razonable", () => {
  const o = calcLiveTotalOuOdds({ home_score: 0, away_score: 0, progress: "10" }, { homeGoalsAvg: 1.4, awayGoalsAvg: 1.3 }, "over_2.5")!
  assert.ok(o > 1.2 && o <= 7.0, `over ${o}`)
})
