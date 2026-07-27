# Apuestas en vivo — M4 (enriquecimiento) · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Poblar y mostrar datos visuales del evento: canales de TV ("dónde ver") + imágenes,
estadísticas finales y highlights de YouTube. Todo cacheado en `metadata`, 1 llamada por evento,
sin IA, sin tablas nuevas.

**Architecture:** Normalizadores puros (testeados) en `lib/tsdb-normalize.ts`; fetchers en
`lib/tsdb.ts`. `event_tv` se cachea en el poller `sync-live` (featured live, si falta). `event_stats`
+ `strVideo` se cachean al finalizar en `sync-scores`. La pantalla `/event/[id]` renderiza las
secciones cuando existen (degrada con elegancia).

**Spec:** `docs/superpowers/specs/2026-07-26-live-in-play-betting-design.md` §2, §6.6

---

### Task 1: Normalizadores puros — TDD (`lib/tsdb-normalize.ts`)

- [ ] **Step 1: Test** `lib/tsdb-normalize.test.ts`
```ts
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
```

- [ ] **Step 2: Correr, ver fallar** — `npm test`.

- [ ] **Step 3: Implementar** `lib/tsdb-normalize.ts`
```ts
export interface TvChannel { name: string; country: string; logo: string | null }
export interface TvImages { thumb: string | null; poster: string | null; banner: string | null }
export interface EventStat { stat: string; home: number | null; away: number | null }

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function normalizeTvChannels(raw: any[]): { channels: TvChannel[]; images: TvImages } {
  const list = Array.isArray(raw) ? raw : []
  const channels: TvChannel[] = list
    .filter((c) => (c?.strChannel || "").trim().length > 0)
    .map((c) => ({ name: c.strChannel, country: c.strCountry || "", logo: c.strLogo || null }))
  const first = list[0] || {}
  return {
    channels,
    images: {
      thumb: first.strEventThumb || null,
      poster: first.strEventPoster || null,
      banner: first.strEventBanner || null,
    },
  }
}

export function normalizeEventStats(raw: any[]): EventStat[] {
  const list = Array.isArray(raw) ? raw : []
  return list
    .filter((s) => (s?.strStat || "").trim().length > 0)
    .map((s) => ({ stat: s.strStat, home: num(s.intHome), away: num(s.intAway) }))
}
```

- [ ] **Step 4: Correr, ver pasar** — `npm test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(live): pure TSDB tv/stats normalizers (TDD)"`

---

### Task 2: Fetchers en `lib/tsdb.ts`

- [ ] **Step 1:** Añadir al final de `lib/tsdb.ts`:
```ts
/** TV channels + event images (V2). Populated pre-match for major leagues. */
export async function tsdbEventTv(idEvent: string): Promise<any[]> {
  const data = await fetchTsdbV2(`/lookup/event_tv/${idEvent}`)
  return data.lookup || []
}

/** Final match statistics (V2). Post-match, major leagues only. */
export async function tsdbEventStats(idEvent: string): Promise<any[]> {
  const data = await fetchTsdbV2(`/lookup/event_stats/${idEvent}`)
  return data.lookup || []
}
```

- [ ] **Step 2: Verificar** — `npm run build`.
- [ ] **Step 3: Commit** — `git commit -m "feat(live): add tsdbEventTv + tsdbEventStats fetchers"`

---

### Task 3: Cachear `event_tv` en el poller (featured live, si falta)

**Files:** Modify `app/api/cron/sync-live/route.ts`

- [ ] **Step 1:** Dentro del `targets.map`, tras el update de `metadata.live`, si `!md.tv`:
```ts
      if (!md.tv) {
        try {
          const { tsdbEventTv } = await import("@/lib/tsdb")
          const { normalizeTvChannels } = await import("@/lib/tsdb-normalize")
          const idEvent = ev.external_id.replace("tsdb_", "")
          const rawTv = await tsdbEventTv(idEvent)
          const { channels, images } = normalizeTvChannels(rawTv)
          if (channels.length || images.thumb) {
            await supabase.from("events").update({
              metadata: { ...md, live, tv: { fetched_at: new Date(now).toISOString(), channels }, images },
            }).eq("id", ev.id)
          }
        } catch { /* enrichment is best-effort */ }
      }
```
(Colocar de forma que no duplique el update de `metadata.live`; usar un merge final.)

- [ ] **Step 2: Verificar** — `npm run build`.
- [ ] **Step 3: Commit** — `git commit -m "feat(live): cache TV channels/images in poller for featured live events"`

---

### Task 4: Enriquecer al finalizar en `sync-scores` (stats + video)

**Files:** Modify `app/api/cron/sync-scores/route.ts`

- [ ] **Step 1:** En el bloque de eventos `justFinished`, para cada evento (`tsdb_`), obtener stats + video:
```ts
    // M4 enrichment: final stats (event_stats) + highlights (strVideo)
    try {
      const { tsdbEventStats, tsdbLookupEvent } = await import("@/lib/tsdb")
      const { normalizeEventStats } = await import("@/lib/tsdb-normalize")
      const idEvent = ev.external_id.replace("tsdb_", "")
      const [rawStats, raw] = await Promise.all([
        tsdbEventStats(idEvent).catch(() => []),
        tsdbLookupEvent(idEvent).catch(() => null),
      ])
      const stats = normalizeEventStats(rawStats)
      const video = raw?.strVideo || null
      if (stats.length || video) {
        const { data: row } = await supabase.from("events").select("metadata").eq("id", ev.id).single()
        const md = row?.metadata || {}
        await supabase.from("events").update({
          metadata: { ...md, ...(stats.length ? { match_stats: stats } : {}), ...(video ? { video } : {}) },
        }).eq("id", ev.id)
      }
    } catch { /* best-effort */ }
```
(Insertar en el loop `for (const ev of justFinished)` que ya existe, o crear uno análogo.)

- [ ] **Step 2: Verificar** — `npm run build`.
- [ ] **Step 3: Commit** — `git commit -m "feat(live): cache final stats + highlights on match finish"`

---

### Task 5: Render en la pantalla (`/event/[id]`)

**Files:** Modify `app/event/[id]/page.tsx`

- [ ] **Step 1:** Añadir, cuando `event.status === "finished"`:
  - tabla `metadata.match_stats` (stat · home · away),
  - botón/enlace a `metadata.video` (YouTube).
  Degradan con elegancia si no existen. (Los canales "dónde ver" ya se renderizan desde M1.)

- [ ] **Step 2: Verificar** — `npm run build` + revisión manual.
- [ ] **Step 3: Commit** — `git commit -m "feat(live): render final stats + highlights on event screen"`

---

## Fin del roadmap live
M1 (panel) · M2 (P2P-live) · M3 (casa-live) · M4 (enriquecimiento). Pendiente operativo: cron externo
`/api/cron/sync-live` (1 min) y QA manual con dinero real.
