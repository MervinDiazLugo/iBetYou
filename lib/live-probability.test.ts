import { test } from "node:test"
import assert from "node:assert/strict"
import { getLiveProbability } from "./live-probability.ts"

test("football: empate 0-0 al minuto 0 ≈ prior equilibrado", () => {
  const p = getLiveProbability("football", { home_score: 0, away_score: 0, progress: "0", status: "1H" }, { homeGoalsAvg: 1.3, awayGoalsAvg: 1.3 })
  assert.ok(Math.abs(p.home! - p.away!) < 0.05, "home≈away con prior simétrico")
  assert.ok((p.home! + (p.draw ?? 0) + p.away!) > 0.99, "suman ~1")
})

test("football: local 1-0 al minuto 88 → local muy probable", () => {
  const p = getLiveProbability("football", { home_score: 1, away_score: 0, progress: "88", status: "2H" }, { homeGoalsAvg: 1.3, awayGoalsAvg: 1.3 })
  assert.ok(p.home! > 0.8, `esperaba local>0.8, fue ${p.home}`)
})

test("basketball: +15 al final del Q4 → casi seguro", () => {
  const p = getLiveProbability("basketball", { home_score: 90, away_score: 75, progress: "Q4", status: "Q4" }, null)
  assert.ok(p.home > 0.9, `esperaba >0.9, fue ${p.home}`)
  assert.equal(p.draw, undefined)
})

test("baseball: +3 en inning 8 → local favorito claro", () => {
  const p = getLiveProbability("baseball", { home_score: 5, away_score: 2, progress: "IN8", status: "IN8" }, null)
  assert.ok(p.home > 0.85, `esperaba >0.85, fue ${p.home}`)
})

test("todas las probabilidades entre 0 y 1", () => {
  const p = getLiveProbability("football", { home_score: 2, away_score: 2, progress: "45", status: "HT" }, null)
  for (const v of [p.home, p.draw ?? 0.5, p.away]) assert.ok(v >= 0 && v <= 1)
})
