# Apuestas en vivo — M2 (P2P-en-vivo + liquidación) · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Permitir crear/tomar apuestas P2P **durante** el partido y liquidarlas automáticamente
desde el poller (mid-match) y al finalizar. La casa es neutral (solo cobra fee). Sin tablas nuevas.

**Architecture:** Mercados binarios (creador elige un lado, aceptante toma el opuesto), liquidables
solo con marcador + estado + fin — sin `strResult`. Motor de decisión puro y testeado
(`lib/live-settlement.ts`). El `baseline` (marcador/minuto al crear) se guarda en el JSON de
`selection`, sin cambios de esquema. Pagos reusan `payoutToMode` + `calculateTotalPrize`.

**Tech Stack:** Next.js 16, TypeScript, Supabase, `node --test`.

**Spec:** `docs/superpowers/specs/2026-07-26-live-in-play-betting-design.md` §4.2

---

## Mercados P2P-en-vivo (M2)

Binarios, resolubles con marcador + fin. Los 3 deportes.

| `bet_type` | Deportes | `creator_selection` | Resuelve |
|---|---|---|---|
| `live_more_scoring` | ⚽🏀⚾ | `yes` / `no` | `yes` gana apenas sube el total desde el baseline; `no` gana si termina igual |
| `live_next_team_scores` | ⚽🏀⚾ | `home` / `away` | quién anota el próximo tanto desde el baseline; ambos en la misma ventana → void; nadie al final → void |

`baseline` = `{ home, away, minute }` capturado **en el servidor** al crear (desde `metadata.live`),
guardado dentro del JSON de `selection`.

---

### Task 1: Definiciones + labels de tipos live

**Files:**
- Create: `lib/live-bet-types.ts`
- Modify: `lib/bet-labels.ts`

- [ ] **Step 1: Crear `lib/live-bet-types.ts`**
```ts
export const LIVE_P2P_BET_TYPES = ["live_more_scoring", "live_next_team_scores"] as const
export type LiveP2PBetType = (typeof LIVE_P2P_BET_TYPES)[number]

export function isLiveP2PBetType(t: string): t is LiveP2PBetType {
  return (LIVE_P2P_BET_TYPES as readonly string[]).includes(t)
}

// Scoring noun per sport, for labels.
export function scoringNoun(sport: string): string {
  if (sport === "basketball") return "puntos"
  if (sport === "baseball") return "carreras"
  return "goles"
}
```

- [ ] **Step 2: Añadir labels en `lib/bet-labels.ts`** (dentro de `formatHouseSelection`, antes del `return` final)
```ts
  if (betType === "live_more_scoring") {
    if (selection === "yes") return "Habrá más anotaciones"
    if (selection === "no") return "No habrá más anotaciones"
  }
  if (betType === "live_next_team_scores") {
    if (selection === "home") return homeTeam ? `${homeTeam} anota primero` : "Local anota primero"
    if (selection === "away") return awayTeam ? `${awayTeam} anota primero` : "Visita anota primero"
  }
```
y en `formatHouseBetTypeLabel` el mapa `labels`:
```ts
    live_more_scoring: "¿Más anotaciones? (en vivo)",
    live_next_team_scores: "Próximo en anotar (en vivo)",
```

- [ ] **Step 3: Commit**
```bash
git add lib/live-bet-types.ts lib/bet-labels.ts
git commit -m "feat(live): P2P-live bet type defs + labels"
```

---

### Task 2: Motor de liquidación puro — TDD

**Files:**
- Create: `lib/live-settlement.ts`
- Test: `lib/live-settlement.test.ts`

```ts
export interface SettleCtx {
  cur: { home: number; away: number }       // marcador actual
  baseline: { home: number; away: number }  // marcador al crear la apuesta
  finished: boolean
}
export type SettleResult =
  | { status: "pending" }
  | { status: "void" }
  | { status: "resolved"; winner: "creator" | "acceptor" }

export function settleLiveBet(betType: string, creatorSelection: string, ctx: SettleCtx): SettleResult
```

- [ ] **Step 1: Test que falla** — `lib/live-settlement.test.ts`
```ts
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
```

- [ ] **Step 2: Correr, ver fallar** — `npm test`.

- [ ] **Step 3: Implementar `lib/live-settlement.ts`**
```ts
export interface SettleCtx {
  cur: { home: number; away: number }
  baseline: { home: number; away: number }
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
```

- [ ] **Step 4: Correr, ver pasar** — `npm test` (9 tests nuevos PASS).

- [ ] **Step 5: Commit**
```bash
git add lib/live-settlement.ts lib/live-settlement.test.ts
git commit -m "feat(live): pure P2P-live settlement engine (TDD)"
```

---

### Task 3: Carve-out de creación para tipos live

**Files:**
- Modify: `app/api/bets/create/route.ts`

El bloqueo `matchStarted` debe **exceptuar** los tipos P2P-live cuando el evento está `live` y tiene
`metadata.live`. Además, capturar el `baseline` server-side y meterlo en el `selection` JSON.

- [ ] **Step 1: Importar** al tope:
```ts
import { isLiveP2PBetType } from "@/lib/live-bet-types"
```

- [ ] **Step 2: Traer `metadata` del evento** — en el `select` del evento, añadir `metadata`:
```ts
supabase.from("events").select("id, sport, status, start_time, metadata").eq("id", eventId).single(),
```

- [ ] **Step 3: Exceptuar el bloqueo** — reemplazar el bloque `if (matchStarted) { ... }`:
```ts
    const isLiveMarket = isLiveP2PBetType(betType)
    const liveMeta = (eventRow as any).metadata?.live
    const canLiveBet = isLiveMarket && eventRow.status === "live" && liveMeta && !liveMeta.suspended

    const matchStarted = eventRow.status === "live" ||
      (eventRow.start_time && new Date(eventRow.start_time) <= new Date())
    if (matchStarted && !canLiveBet) {
      return NextResponse.json(
        { error: "Este partido ya comenzó. No se pueden crear nuevas apuestas." },
        { status: 400 }
      )
    }
```

- [ ] **Step 4: Inyectar baseline** — justo antes del `insert` de la bet, si es live market:
```ts
    let selectionToStore = selection
    if (canLiveBet) {
      selectionToStore = {
        ...selection,
        live_baseline: { home: liveMeta.home_score ?? 0, away: liveMeta.away_score ?? 0, minute: liveMeta.progress ?? null },
      }
    }
```
y en el `insert` cambiar `selection: JSON.stringify(selection)` → `selection: JSON.stringify(selectionToStore)`.

- [ ] **Step 5: Verificar** — `npm run build`.

- [ ] **Step 6: Commit**
```bash
git add app/api/bets/create/route.ts
git commit -m "feat(live): allow creating P2P-live bets during the match with server baseline"
```

---

### Task 4: Liquidación en el poller + al finalizar

**Files:**
- Create: `lib/settle-live-bets.ts` (helper compartido, mueve dinero con el invariante de pagos)
- Modify: `app/api/cron/sync-live/route.ts` (llamar tras actualizar `metadata.live`)
- Modify: `app/api/admin/bets/auto-resolve-finished/route.ts` (liquidar los pendientes al finalizar)

- [ ] **Step 1: Crear `lib/settle-live-bets.ts`**
```ts
import { settleLiveBet } from "@/lib/live-settlement"
import { isLiveP2PBetType } from "@/lib/live-bet-types"
import { calculateTotalPrize } from "@/lib/bet-resolution"
import { payoutToMode } from "@/lib/wallet-utils"
import { createNotifications } from "@/lib/notifications"

type Admin = any

// Settles all 'taken' P2P-live bets for one event. Payment invariant: status first, money after.
export async function settleLiveBetsForEvent(
  supabase: Admin,
  eventId: number,
  cur: { home: number; away: number },
  finished: boolean
): Promise<number> {
  const { data: bets } = await supabase
    .from("bets")
    .select("id, creator_id, acceptor_id, bet_type, creator_selection, selection, amount, multiplier, mode, status")
    .eq("event_id", eventId)
    .eq("status", "taken")
  if (!bets?.length) return 0

  let settled = 0
  for (const bet of bets) {
    if (!isLiveP2PBetType(bet.bet_type)) continue
    let baseline = { home: 0, away: 0 }
    try {
      const parsed = typeof bet.selection === "string" ? JSON.parse(bet.selection) : bet.selection
      if (parsed?.live_baseline) baseline = { home: Number(parsed.live_baseline.home) || 0, away: Number(parsed.live_baseline.away) || 0 }
    } catch { /* keep zero baseline */ }

    const res = settleLiveBet(bet.bet_type, bet.creator_selection, { cur, baseline, finished })
    if (res.status === "pending") continue

    if (res.status === "void") {
      // Refund both stakes; payment invariant: mark cancelled first
      const { data: upd } = await supabase.from("bets").update({ status: "cancelled" }).eq("id", bet.id).eq("status", "taken").select("id")
      if (!upd?.length) continue
      await payoutToMode(supabase, bet.creator_id, Number(bet.amount), bet.mode)
      if (bet.acceptor_id) await payoutToMode(supabase, bet.acceptor_id, Number(bet.amount), bet.mode)
      settled++
      continue
    }

    const winnerId = res.winner === "creator" ? bet.creator_id : bet.acceptor_id
    if (!winnerId) continue
    const loserId = res.winner === "creator" ? bet.acceptor_id : bet.creator_id
    const { data: upd } = await supabase.from("bets")
      .update({ status: "resolved", winner_id: winnerId, resolved_at: new Date().toISOString() })
      .eq("id", bet.id).eq("status", "taken").select("id")
    if (!upd?.length) continue
    const prize = calculateTotalPrize(bet.amount, bet.multiplier)
    await payoutToMode(supabase, winnerId, prize, bet.mode)
    await createNotifications([
      { userId: winnerId, type: "bet_resolved_win", title: "¡Ganaste!", body: "Tu apuesta en vivo se resolvió a tu favor.", betId: bet.id },
      ...(loserId ? [{ userId: loserId, type: "bet_resolved_loss" as const, title: "Apuesta perdida", body: "Tu apuesta en vivo se resolvió en contra.", betId: bet.id }] : []),
    ], supabase)
    settled++
  }
  return settled
}
```

- [ ] **Step 2: Llamar desde `sync-live`** — dentro del `targets.map` async, tras el `update` de `metadata`, añadir:
```ts
      const { settleLiveBetsForEvent } = await import("@/lib/settle-live-bets")
      await settleLiveBetsForEvent(supabase, ev.id, { home, away }, false)
```

- [ ] **Step 3: Llamar desde `auto-resolve-finished`** — tras determinar que el evento está `finished`
y antes/junto al resto de resolución, añadir una pasada:
```ts
    const { settleLiveBetsForEvent } = await import("@/lib/settle-live-bets")
    await settleLiveBetsForEvent(supabase, eventRow.id, { home: eventRow.home_score ?? 0, away: eventRow.away_score ?? 0 }, true)
```
(Ubicar donde `eventRow` con `home_score/away_score` esté disponible; ver el handler existente.)

- [ ] **Step 4: Verificar** — `npm run build`.

- [ ] **Step 5: Commit**
```bash
git add lib/settle-live-bets.ts app/api/cron/sync-live/route.ts app/api/admin/bets/auto-resolve-finished/route.ts
git commit -m "feat(live): settle P2P-live bets in poller (mid-match) and at finish"
```

---

### Task 5: UI de crear/tomar en la pantalla de evento

**Files:**
- Modify: `app/event/[id]/page.tsx`

Añadir, cuando `isLive` y `live` no suspendido, una sección "Apuestas en vivo · P2P" con:
- dos mercados (más anotaciones sí/no; próximo en anotar local/visita) → POST a `/api/bets/create`
  con `betType`, `selection: { selection }`, `amount`, `mode`.
- lista de P2P-live abiertas de este evento (de `openBets`) con botón "Tomar" → PATCH `/api/bets/{id}`.

- [ ] **Step 1: Implementar** el bloque UI (fetch de sesión para el `Authorization`, patrón del CLAUDE.md),
con estados de monto y toasts. (Código en la ejecución, siguiendo el estilo del panel M1.)

- [ ] **Step 2: Verificar** — `npm run build` + revisión manual: crear y tomar una P2P-live.

- [ ] **Step 3: Commit**
```bash
git add "app/event/[id]/page.tsx"
git commit -m "feat(live): create/take P2P-live bets from event screen"
```

---

## Fuera de M2
- `live_goal_before_min` (⚽) — requiere minuto exacto del gol; se pospone.
- M3: mercados casa-en-vivo + cuotas in-play + suspensión + topes.
- M4: enriquecimiento (event_tv cache, stats, highlights).
