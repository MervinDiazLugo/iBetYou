import { test } from "node:test"
import assert from "node:assert/strict"
import { settleLiveBet } from "./live-settlement.ts"

const base = { home: 1, away: 0 }

test("more_scoring: sube el total → gana 'yes' (creator=yes)", () => {
  const r = settleLiveBet("live_more_scoring", "yes", { cur: { home: 2, away: 0 }, baseline: base, finished: false })
  assert.deepEqual(r, { status: "resolved", winner: "creator" })
})
test("more_scoring: sube el total, creator eligió 'no' → gana acceptor", () => {
  const r = settleLiveBet("live_more_scoring", "no", { cur: { home: 1, away: 1 }, baseline: base, finished: false })
  assert.deepEqual(r, { status: "resolved", winner: "acceptor" })
})
test("more_scoring: sin cambios y no terminó → pending", () => {
  const r = settleLiveBet("live_more_scoring", "yes", { cur: { home: 1, away: 0 }, baseline: base, finished: false })
  assert.equal(r.status, "pending")
})
test("more_scoring: termina igual → gana 'no'", () => {
  const r = settleLiveBet("live_more_scoring", "no", { cur: { home: 1, away: 0 }, baseline: base, finished: true })
  assert.deepEqual(r, { status: "resolved", winner: "creator" })
})

test("next_team: anota local → gana 'home'", () => {
  const r = settleLiveBet("live_next_team_scores", "home", { cur: { home: 2, away: 0 }, baseline: base, finished: false })
  assert.deepEqual(r, { status: "resolved", winner: "creator" })
})
test("next_team: anota visita, creator eligió 'home' → gana acceptor", () => {
  const r = settleLiveBet("live_next_team_scores", "home", { cur: { home: 1, away: 1 }, baseline: base, finished: false })
  assert.deepEqual(r, { status: "resolved", winner: "acceptor" })
})
test("next_team: ambos anotan en la misma ventana → void", () => {
  const r = settleLiveBet("live_next_team_scores", "home", { cur: { home: 2, away: 1 }, baseline: base, finished: false })
  assert.equal(r.status, "void")
})
test("next_team: nadie anota y termina → void", () => {
  const r = settleLiveBet("live_next_team_scores", "home", { cur: { home: 1, away: 0 }, baseline: base, finished: true })
  assert.equal(r.status, "void")
})
test("next_team: nadie anota aún → pending", () => {
  const r = settleLiveBet("live_next_team_scores", "home", { cur: { home: 1, away: 0 }, baseline: base, finished: false })
  assert.equal(r.status, "pending")
})
