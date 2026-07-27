# Apuestas en vivo — M3 (casa-en-vivo + cuotas in-play) · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Ofrecer apuestas **vs. la casa durante el partido** con cuota recalculada en vivo,
suspensión de protección y topes de exposición. Liquidan al final. Sin tablas nuevas.

**Architecture:** Cuotas = `getLiveProbability` (M1) + margen casa + `LIVE_EDGE`, con caps. Mercados:
`live_match_winner` (⚽🏀⚾) y `live_total_ou` (⚽). Se crean por `/api/bets/house` con carve-out live;
liquidan en `auto-resolve-finished` reusando `resolveDirect` y la lógica de total over/under.

**Spec:** `docs/superpowers/specs/2026-07-26-live-in-play-betting-design.md` §4.1, §5

---

### Task 1: Cuotas in-play — TDD (`lib/live-house-odds.ts`)

Funciones: `calcLiveMatchWinnerOdds(sport, live, prior, selection)`, `calcLiveTotalOuOdds(live, prior, selection)`.
`LIVE_EDGE = 1.05` sobre `HOUSE_EDGE = 1.10`. Caps: winner 4.0 (empate 150), total 7.0. Piso 1.02.

- [ ] **Step 1: Test** `lib/live-house-odds.test.ts`
```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { calcLiveMatchWinnerOdds, calcLiveTotalOuOdds } from "./live-house-odds.ts"

test("winner: local 1-0 min 88 → cuota local baja (favorito)", () => {
  const o = calcLiveMatchWinnerOdds("football", { home_score: 1, away_score: 0, progress: "88", status: "2H" }, { homeGoalsAvg: 1.3, awayGoalsAvg: 1.3 }, "home")!
  assert.ok(o >= 1.02 && o < 1.35, `cuota local ${o}`)
})
test("winner: visita 1-0 abajo min 88 → cuota visita alta, capada a 4.0", () => {
  const o = calcLiveMatchWinnerOdds("football", { home_score: 1, away_score: 0, progress: "88", status: "2H" }, { homeGoalsAvg: 1.3, awayGoalsAvg: 1.3 }, "away")!
  assert.ok(o <= 4.0 && o > 2, `cuota visita ${o}`)
})
test("winner: prob 0 → null", () => {
  const o = calcLiveMatchWinnerOdds("basketball", { home_score: 120, away_score: 60, progress: "Q4", status: "Q4" }, null, "away")
  assert.ok(o === null || o === 4.0)
})
test("total: 3 goles, over_2.5 ya superado → piso ~1.02", () => {
  const o = calcLiveTotalOuOdds({ home_score: 2, away_score: 1, progress: "70", status: "2H" }, { homeGoalsAvg: 1.3, awayGoalsAvg: 1.3 }, "over_2.5")!
  assert.ok(o >= 1.02 && o < 1.2, `over ${o}`)
})
test("total: 3 goles, under_2.5 imposible → null", () => {
  const o = calcLiveTotalOuOdds({ home_score: 2, away_score: 1, progress: "70", status: "2H" }, null, "under_2.5")
  assert.equal(o, null)
})
test("total: 0-0 min 10, over_2.5 incierto → cuota razonable", () => {
  const o = calcLiveTotalOuOdds({ home_score: 0, away_score: 0, progress: "10", status: "1H" }, { homeGoalsAvg: 1.4, awayGoalsAvg: 1.3 }, "over_2.5")!
  assert.ok(o > 1.2 && o <= 7.0, `over ${o}`)
})
```

- [ ] **Step 2: Correr, ver fallar** — `npm test`.

- [ ] **Step 3: Implementar** `lib/live-house-odds.ts`
```ts
import { getLiveProbability, type LiveState, type Prior } from "./live-probability"

const HOUSE_EDGE = 1.10
const LIVE_EDGE = 1.05
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

export function calcLiveMatchWinnerOdds(
  sport: "football" | "basketball" | "baseball",
  live: LiveState,
  prior: Prior | null | undefined,
  selection: string
): number | null {
  const wp = getLiveProbability(sport, live, prior)
  const p = selection === "home" ? wp.home : selection === "away" ? wp.away : selection === "draw" ? wp.draw : undefined
  if (p === undefined) return null
  const cap = selection === "draw" ? MAX_DRAW_ODDS : MAX_TEAM_ODDS
  return priceFromProb(p, cap)
}

export function calcLiveTotalOuOdds(
  live: LiveState,
  prior: Prior | null | undefined,
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
  let pOver: number
  if (need < 0) pOver = 1
  else pOver = 1 - poissonCdf(Math.floor(need), lambdaRem)
  const p = dir === "over" ? pOver : 1 - pOver
  return priceFromProb(p, MAX_TOTAL_ODDS)
}
```

- [ ] **Step 4: Correr, ver pasar** — `npm test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(live): in-play house odds (match winner + total O/U, TDD)"`

---

### Task 2: Carve-out en `/api/bets/house` para mercados casa-en-vivo

**Files:** Modify `app/api/bets/house/route.ts`

- [ ] **Step 1: Import**
```ts
import { calcLiveMatchWinnerOdds, calcLiveTotalOuOdds } from "@/lib/live-house-odds"
```

- [ ] **Step 2: Detectar mercado live + validar suspensión/frescura.** Antes del bloqueo "partido ya comenzó", definir:
```ts
    const LIVE_HOUSE_TYPES = ["live_match_winner", "live_total_ou"]
    const isLiveHouse = LIVE_HOUSE_TYPES.includes(betType)
    const liveMeta = (eventRow.metadata as any)?.live
    const liveFresh = liveMeta && (Date.now() - new Date(liveMeta.updated_at).getTime() < 6 * 60 * 1000)
    const canLiveHouse = isLiveHouse && eventRow.status === "live" && liveFresh && !liveMeta.suspended
```
Modificar el bloqueo de "match started" para exceptuar `canLiveHouse`:
```ts
      if ((isLive || startTimePassed) && !canLiveHouse) {
        return NextResponse.json({ error: "Este partido ya comenzó. No se pueden crear apuestas." }, { status: 400 })
      }
```

- [ ] **Step 3: allowedBetTypes** — añadir los tipos live cuando el evento está live:
```ts
    if (canLiveHouse) allowedBetTypes = [...allowedBetTypes, "live_match_winner", "live_total_ou"]
```
(y para `live_total_ou` restringir a `sport === "football"`).

- [ ] **Step 4: Cálculo de cuota** — añadir ramas (junto a las demás `else if (betType === ...)`):
```ts
    } else if (betType === "live_match_winner") {
      const prior = { homeGoalsAvg: Number(metadata?.predictions?.home_goals_avg) || undefined, awayGoalsAvg: Number(metadata?.predictions?.away_goals_avg) || undefined }
      houseOdds = calcLiveMatchWinnerOdds(sport as any, {
        home_score: liveMeta.home_score, away_score: liveMeta.away_score, progress: String(liveMeta.progress ?? ""), status: String(liveMeta.status ?? ""),
      }, prior, String(selection))
      if (houseOdds === null) return NextResponse.json({ error: "Cuota en vivo no disponible" }, { status: 400 })
    } else if (betType === "live_total_ou") {
      if (sport !== "football") return NextResponse.json({ error: "Total en vivo solo disponible para fútbol" }, { status: 400 })
      const prior = { homeGoalsAvg: Number(metadata?.predictions?.home_goals_avg) || undefined, awayGoalsAvg: Number(metadata?.predictions?.away_goals_avg) || undefined }
      houseOdds = calcLiveTotalOuOdds({
        home_score: liveMeta.home_score, away_score: liveMeta.away_score, progress: String(liveMeta.progress ?? ""), status: String(liveMeta.status ?? ""),
      }, prior, String(selection))
      if (houseOdds === null) return NextResponse.json({ error: "Cuota en vivo no disponible" }, { status: 400 })
    }
```
La exposición usa el default (`MAX_EXACT_EXPOSURE`) — no requiere cambios (el `else` cubre live).

- [ ] **Step 5: Verificar** — `npm run build`.
- [ ] **Step 6: Commit** — `git commit -m "feat(live): create house-live bets during match with in-play odds + suspension guard"`

---

### Task 3: Liquidación al finalizar

**Files:** Modify `app/api/admin/bets/auto-resolve-finished/route.ts`

- [ ] **Step 1: Añadir a `RESOLVABLE_TYPES`** (línea ~514): `"live_match_winner", "live_total_ou"`.

- [ ] **Step 2: Ramas de resolución** — en el dispatch (junto a `direct`):
```ts
      } else if (betType === "live_match_winner") {
        resolution = resolveDirect(creatorSelection, eventRow, betForResolver)
      } else if (betType === "live_total_ou") {
        resolution = resolveGoalsOverUnder(creatorSelection, eventRow, betForResolver)
```

- [ ] **Step 3: Verificar** — `npm run build`.
- [ ] **Step 4: Commit** — `git commit -m "feat(live): settle house-live bets at finish (winner + total O/U)"`

---

### Task 4: Tablero de cuotas casa-en-vivo en la pantalla

**Files:** Modify `app/event/[id]/page.tsx`

- [ ] **Step 1:** Añadir sección "🏛 Apuestas en vivo · vs. la casa" (solo `isLive && live && !live.suspended`),
que consulta cuotas al vuelo con las funciones `calc*` importadas de `@/lib/live-house-odds` sobre
`live` + `predictions`, y muestra botones (Local/Empate/Visita y 2-3 líneas de total) que POSTean a
`/api/bets/house` con `betType`, `selection`, `amount`, `mode`. Si `suspended`, mostrar aviso.

- [ ] **Step 2:** Verificar — `npm run build` + revisión manual.
- [ ] **Step 3: Commit** — `git commit -m "feat(live): house-live odds board on event screen"`

---

## Fuera de M3
- `live_total_ou` basket/béisbol (requiere modelo de ritmo por deporte).
- M4: enriquecimiento (event_tv cache, event_stats, highlights) + pulido.
