import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeTvChannels, normalizeEventStats } from "./tsdb-normalize.ts"

test("tv: extrae canales + imágenes", () => {
  const raw = [
    { strChannel: "DirecTV Sports", strCountry: "Argentina", strLogo: "http://l1", strEventThumb: "http://t", strEventPoster: "http://p" },
    { strChannel: "ESPN", strCountry: "Mexico", strLogo: "http://l2" },
    { strChannel: "", strCountry: "X", strLogo: "" },
  ]
  const r = normalizeTvChannels(raw)
  assert.equal(r.channels.length, 2)
  assert.deepEqual(r.channels[0], { name: "DirecTV Sports", country: "Argentina", logo: "http://l1" })
  assert.equal(r.images.thumb, "http://t")
  assert.equal(r.images.poster, "http://p")
})
test("tv: vacío → sin canales, imágenes null", () => {
  const r = normalizeTvChannels([])
  assert.equal(r.channels.length, 0)
  assert.equal(r.images.thumb, null)
})
test("stats: mapea strStat/intHome/intAway", () => {
  const raw = [
    { strStat: "Shots on Goal", intHome: "9", intAway: "3" },
    { strStat: "Possession", intHome: "58", intAway: "42" },
  ]
  const r = normalizeEventStats(raw)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], { stat: "Shots on Goal", home: 9, away: 3 })
})
test("stats: filtra filas sin strStat", () => {
  const r = normalizeEventStats([{ strStat: "", intHome: "1", intAway: "2" }])
  assert.equal(r.length, 0)
})
