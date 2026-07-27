# Apuestas en vivo — M1 (fundación) · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Pantalla `/event/[id]` (nueva pestaña desde el marketplace) con panel en vivo de solo
lectura (marcador, probabilidad calculada, línea de tiempo, análisis, dónde ver), alimentada por
un poller de 1 min que escribe `metadata.live`. Sin tipos de apuesta nuevos todavía.

**Architecture:** Probabilidad in-play = matemática pura (Poisson/Normal) en `lib/live-probability.ts`,
detrás de una interfaz modular. Poller externo (`/api/cron/sync-live`) escribe `metadata.live` en la
tabla `events`. La pantalla lee de un endpoint público que sirve de DB. Cero IA, cero dependencias nuevas.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase, TheSportsDB Premium, `node --test` (built-in).

**Spec:** `docs/superpowers/specs/2026-07-26-live-in-play-betting-design.md`

---

### Task 1: Runner de tests sin dependencias

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Añadir script de test** (usa el runner nativo de Node 22, cero deps)

En `package.json` `"scripts"`, añadir:
```json
"test": "node --test --experimental-strip-types \"lib/**/*.test.ts\""
```

- [ ] **Step 2: Verificar** — `npm test` → debe decir "0 tests" (aún no hay). Expected: exit 0.

- [ ] **Step 3: Commit**
```bash
git add package.json && git commit -m "chore: add node --test runner for pure-logic units"
```

---

### Task 2: Probabilidad in-play (matemática pura) — TDD

**Files:**
- Create: `lib/live-probability.ts`
- Test: `lib/live-probability.test.ts`

Interfaz modular (única fachada que consumirá el resto):
```ts
export interface LiveState { home_score: number; away_score: number; progress: string; status: string }
export interface WinProb { home: number; draw?: number; away: number }
export function getLiveProbability(
  sport: "football" | "basketball" | "baseball",
  live: LiveState,
  prior?: { homeGoalsAvg?: number; awayGoalsAvg?: number } | null
): WinProb
```

- [ ] **Step 1: Test que falla** — `lib/live-probability.test.ts`
```ts
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
```

- [ ] **Step 2: Correr y ver fallar** — `npm test` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar** — `lib/live-probability.ts`
```ts
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
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  if (z > 0) p = 1 - p
  return 1 - p
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

// MLB win-expectancy by (run diff, inning) — home team, coarse static table.
function baseballProb(live: LiveState): WinProb {
  const m = /IN(\d+)/.exec(live.progress || live.status)
  const inning = Math.min(m ? Number(m[1]) : 1, 9)
  const diff = live.home_score - live.away_score
  // logistic in diff, steepening as innings pass
  const k = 0.55 + 0.12 * inning
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
```

- [ ] **Step 4: Correr y ver pasar** — `npm test` → PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
git add lib/live-probability.ts lib/live-probability.test.ts
git commit -m "feat: add pure-math in-play win probability (football/basketball/baseball)"
```

---

### Task 3: Poller en vivo `/api/cron/sync-live`

**Files:**
- Create: `app/api/cron/sync-live/route.ts`

Lógica (patrón idéntico al `sync-scores` existente para auth/cliente):
- Gate: buscar eventos `status='live'` con al menos una bet en `('open','taken')` **o** `featured=true`.
  Si no hay → responder `{ skipped: true }` sin tocar la API.
- Reunir `idLeague` de esos eventos → llamar `tsdbLivescore` por liga (o por deporte como fallback).
  Reusar helpers de `lib/tsdb.ts` (`tsdbLivescoreSoccer/Basketball/Baseball`, `mapTsdbStatus`).
- Por evento: leer marcador/estado/progreso del livescore; construir `metadata.live` con
  `getLiveProbability`; si el marcador cambió respecto al último snapshot, empujar snapshot
  (capado a 30); marcar `suspended` si el marcador cambió en este ciclo o el dato es viejo (>6 min).
- Escribir `events.metadata` (merge con lo existente, sin pisar `predictions`).

- [ ] **Step 1: Implementar** (código completo)
```ts
import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { tsdbLivescoreSoccer, tsdbLivescoreBasketball, tsdbLivescoreBaseball, mapTsdbStatus } from "@/lib/tsdb"
import { getLiveProbability, type LiveState } from "@/lib/live-probability"

const CRON_SECRET = process.env.CRON_SECRET
const STALE_MS = 6 * 60 * 1000

function toScore(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v); return Number.isFinite(n) ? n : null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const supabase = createAdminSupabaseClient()

  // ── Gate: live events that matter ──
  const { data: liveEvents } = await supabase
    .from("events")
    .select("id, external_id, sport, status, featured, metadata")
    .eq("status", "live")
  if (!liveEvents?.length) return NextResponse.json({ skipped: true, reason: "no live events" })

  const ids = liveEvents.map(e => e.id)
  const { data: activeBets } = await supabase
    .from("bets").select("event_id").in("event_id", ids).in("status", ["open", "taken", "disputed"])
  const withBets = new Set((activeBets || []).map(b => b.event_id))
  const targets = liveEvents.filter(e => withBets.has(e.id) || e.featured)
  if (!targets.length) return NextResponse.json({ skipped: true, reason: "no bets/featured" })

  // ── Fetch livescores (by sport present among targets) ──
  const sports = new Set(targets.map(e => e.sport))
  const liveMap = new Map<string, any>()
  const calls: Promise<any[]>[] = []
  if (sports.has("football")) calls.push(tsdbLivescoreSoccer().catch(() => []))
  if (sports.has("basketball")) calls.push(tsdbLivescoreBasketball().catch(() => []))
  if (sports.has("baseball")) calls.push(tsdbLivescoreBaseball().catch(() => []))
  for (const arr of await Promise.all(calls)) for (const it of arr) liveMap.set(`tsdb_${it.idEvent}`, it)

  const now = Date.now()
  let updated = 0
  await Promise.all(targets.map(async (ev) => {
    const item = liveMap.get(ev.external_id)
    if (!item) return
    const home = toScore(item.intHomeScore) ?? 0
    const away = toScore(item.intAwayScore) ?? 0
    const md = ev.metadata || {}
    const prevLive = md.live || {}
    const prevSnaps: any[] = Array.isArray(prevLive.snapshots) ? prevLive.snapshots : []
    const scoreChanged = prevLive.home_score !== home || prevLive.away_score !== away
    const snapshots = scoreChanged
      ? [...prevSnaps, { t: new Date(now).toISOString(), minute: Number(item.strProgress) || item.strProgress, home, away }].slice(-30)
      : prevSnaps

    const liveState: LiveState = { home_score: home, away_score: away, progress: String(item.strProgress ?? ""), status: (item.strStatus || "").toUpperCase() }
    const prior = {
      homeGoalsAvg: Number(md.predictions?.home_goals_avg) || undefined,
      awayGoalsAvg: Number(md.predictions?.away_goals_avg) || undefined,
    }
    const win_prob = getLiveProbability(ev.sport, liveState, prior)

    const live = {
      status: mapTsdbStatus(item.strStatus) === "live" ? (item.strStatus || "").toUpperCase() : mapTsdbStatus(item.strStatus),
      progress: String(item.strProgress ?? ""),
      home_score: home, away_score: away,
      updated_at: new Date(now).toISOString(),
      snapshots, win_prob,
      suspended: scoreChanged, // one cycle after a score change
      suspend_reason: scoreChanged ? "score_changed" : null,
    }
    await supabase.from("events").update({
      home_score: home, away_score: away,
      metadata: { ...md, live },
    }).eq("id", ev.id)
    updated++
  }))

  return NextResponse.json({ success: true, targets: targets.length, updated })
}
```

- [ ] **Step 2: Verificar tipos** — `npx tsc --noEmit` (o `npm run build`). Expected: sin errores en el archivo nuevo.

- [ ] **Step 3: Commit**
```bash
git add app/api/cron/sync-live/route.ts
git commit -m "feat: add 1-min live poller writing metadata.live (score/prob/snapshots)"
```

---

### Task 4: Endpoint público del panel `/api/events/[id]/live`

**Files:**
- Create: `app/api/events/[id]/live/route.ts`

Devuelve el evento (con `metadata.live`, `metadata.predictions`, `metadata.tv`) + apuestas abiertas
de ese evento. Sirve de la DB (barato); la pantalla hace polling client-side.

- [ ] **Step 1: Implementar**
```ts
import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

const LATAM_ORDER = ["Venezuela","Colombia","Argentina","Mexico","Chile","Peru","Ecuador","Bolivia","Uruguay","Paraguay","Brazil","Spain","United States"]

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const eventId = Number(id)
  if (!Number.isFinite(eventId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const supabase = createAdminSupabaseClient()
  const { data: event, error } = await supabase.from("events").select("*").eq("id", eventId).single()
  if (error || !event) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: openBets } = await supabase
    .from("bets")
    .select("id, bet_type, creator_selection, amount, status, creator_id")
    .eq("event_id", eventId).eq("status", "open")

  // Prioritize TV channels for LATAM audience
  const channels = (event.metadata?.tv?.channels || []).slice().sort((a: any, b: any) => {
    const ia = LATAM_ORDER.indexOf(a.country); const ib = LATAM_ORDER.indexOf(b.country)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  return NextResponse.json({ event: { ...event, metadata: { ...event.metadata, tv: { ...(event.metadata?.tv || {}), channels } } }, openBets: openBets || [] })
}
```

- [ ] **Step 2: Verificar** — `npm run build`. Expected: sin errores.

- [ ] **Step 3: Commit**
```bash
git add "app/api/events/[id]/live/route.ts"
git commit -m "feat: add public event-live endpoint for the event panel"
```

---

### Task 5: Pantalla `/event/[id]` (panel de solo lectura)

**Files:**
- Create: `app/event/[id]/page.tsx`

Client component. Fetch a `/api/events/{id}/live` al montar y cada 30s (`setInterval`). Renderiza,
en el estilo oscuro de la app (Tailwind, mismos colores), las secciones del wireframe: marcador,
barra de probabilidad (de `metadata.live.win_prob`), línea de tiempo (`snapshots`), análisis
(`predictions`), dónde ver (`tv.channels`). Usa `Navbar`. Fechas con `timeZone: 'UTC'`.

- [ ] **Step 1: Implementar** (esqueleto completo, sin placeholders)
```tsx
"use client"
import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import Image from "next/image"
import Link from "next/link"

interface LiveMeta { status: string; progress: string; home_score: number; away_score: number; updated_at: string; snapshots: Array<{ minute: any; home: number; away: number }>; win_prob: { home: number; draw?: number; away: number }; suspended: boolean }
interface EventData { id: number; sport: string; home_team: string; away_team: string; home_logo?: string; away_logo?: string; league: string; status: string; start_time: string; home_score?: number; away_score?: number; metadata?: any }

const sportIcon: Record<string,string> = { football: "⚽", basketball: "🏀", baseball: "⚾" }
const pct = (n: number) => `${Math.round(n * 100)}%`

export default function EventPage() {
  const { id } = useParams<{ id: string }>()
  const [event, setEvent] = useState<EventData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${id}/live`, { cache: "no-store" })
      if (res.ok) { const data = await res.json(); setEvent(data.event) }
    } finally { setLoading(false) }
  }, [id])

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

  if (loading) return (<><Navbar /><div className="max-w-2xl mx-auto p-6 text-gray-400">Cargando…</div></>)
  if (!event) return (<><Navbar /><div className="max-w-2xl mx-auto p-6 text-gray-400">Evento no encontrado.</div></>)

  const live: LiveMeta | undefined = event.metadata?.live
  const isLive = event.status === "live"
  const preds = event.metadata?.predictions
  const channels: Array<{ name: string; country: string; logo?: string }> = event.metadata?.tv?.channels || []
  const wp = live?.win_prob
  const homeScore = live?.home_score ?? event.home_score ?? 0
  const awayScore = live?.away_score ?? event.away_score ?? 0

  return (
    <>
      <Navbar />
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-200">← Volver</Link>

        {/* Scoreboard */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
            <span>{sportIcon[event.sport]} {event.league}</span>
            {isLive
              ? <span className="inline-flex items-center gap-1.5 text-red-400 font-semibold"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />EN VIVO {live?.progress}</span>
              : <span>{new Date(event.start_time).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</span>}
          </div>
          <div className="flex items-center justify-center gap-6">
            <div className="flex-1 text-center">
              {event.home_logo && <Image src={event.home_logo} alt="" width={44} height={44} className="mx-auto object-contain" unoptimized />}
              <div className="text-sm font-semibold mt-1">{event.home_team}</div>
            </div>
            <div className="text-4xl font-extrabold tabular-nums">{homeScore}<span className="text-gray-600 mx-2">–</span>{awayScore}</div>
            <div className="flex-1 text-center">
              {event.away_logo && <Image src={event.away_logo} alt="" width={44} height={44} className="mx-auto object-contain" unoptimized />}
              <div className="text-sm font-semibold mt-1">{event.away_team}</div>
            </div>
          </div>
        </div>

        {/* Live probability */}
        {isLive && wp && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Probabilidad en vivo</div>
            <div className="flex h-3.5 rounded-lg overflow-hidden border border-gray-800">
              <div style={{ width: pct(wp.home) }} className="bg-blue-500" />
              {wp.draw !== undefined && <div style={{ width: pct(wp.draw) }} className="bg-slate-500" />}
              <div style={{ width: pct(wp.away) }} className="bg-orange-500" />
            </div>
            <div className="flex justify-between text-[11px] font-semibold mt-1.5">
              <span className="text-blue-300">Local {pct(wp.home)}</span>
              {wp.draw !== undefined && <span className="text-slate-300">Empate {pct(wp.draw)}</span>}
              <span className="text-orange-300">Visita {pct(wp.away)}</span>
            </div>
          </div>
        )}

        {/* Timeline */}
        {isLive && !!live?.snapshots?.length && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Línea de tiempo</div>
            <div className="space-y-1.5">
              {live.snapshots.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-amber-400 w-10">{String(s.minute)}'</span>
                  <span>{sportIcon[event.sport]} {s.home}–{s.away}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pre-match analysis */}
        {preds?.percent && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">🤖 Análisis pre-partido</div>
            <div className="flex gap-1.5">
              <div className="flex-1 rounded-md bg-blue-500/10 border border-blue-500/20 py-1.5 text-center"><div className="text-[10px] text-gray-500">Local</div><div className="text-sm font-bold text-blue-300">{preds.percent.home}</div></div>
              {preds.percent.draw && <div className="flex-1 rounded-md bg-gray-500/10 border border-gray-500/20 py-1.5 text-center"><div className="text-[10px] text-gray-500">Empate</div><div className="text-sm font-bold text-gray-300">{preds.percent.draw}</div></div>}
              <div className="flex-1 rounded-md bg-orange-500/10 border border-orange-500/20 py-1.5 text-center"><div className="text-[10px] text-gray-500">Visita</div><div className="text-sm font-bold text-orange-300">{preds.percent.away}</div></div>
            </div>
            {preds.advice && <p className="text-xs text-center text-amber-300/80 mt-2">💡 {preds.advice}</p>}
          </div>
        )}

        {/* Dónde ver */}
        {channels.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">📺 Dónde ver</div>
            <div className="grid grid-cols-2 gap-1.5">
              {channels.slice(0, 6).map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md bg-gray-800/60 border border-gray-800 px-2.5 py-1.5 text-xs">
                  {c.logo ? <Image src={c.logo} alt="" width={20} height={20} className="rounded object-contain" unoptimized /> : <span>📡</span>}
                  <span className="font-medium truncate">{c.name}<span className="block text-[9px] text-gray-500">{c.country}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verificar** — `npm run build`. Expected: compila.

- [ ] **Step 3: Commit**
```bash
git add "app/event/[id]/page.tsx"
git commit -m "feat: add /event/[id] live panel screen (read-only)"
```

---

### Task 6: Click en la tarjeta → nueva pestaña

**Files:**
- Modify: `components/marketplace.tsx` (tarjetas de evento featured y por deporte)

Añadir a cada `<Card>` de evento `onClick={() => window.open(\`/event/${event.id}\`, "_blank")}` +
`cursor-pointer`, y asegurar que los botones/áreas de acción internas ya llamen
`e.stopPropagation()` (el bloque de predicciones y varios botones ya lo hacen; añadir a los que falten).

- [ ] **Step 1: Añadir handler a la Card featured**

En la `<Card key={`featured-${event.id}`} …>` añadir:
```tsx
onClick={() => window.open(`/event/${event.id}`, "_blank")}
```
y agregar `cursor-pointer` a su `className`.

- [ ] **Step 2: Añadir handler a la Card por deporte** (misma técnica en la tarjeta regular de evento).

- [ ] **Step 3: Blindar botones internos** — a los `onClick` de "Predecir P2P", "Vs. la casa",
"Ver detalles" y filtros dentro de la tarjeta, envolver el handler para cortar propagación:
```tsx
onClick={(e) => { e.stopPropagation(); /* handler original */ }}
```

- [ ] **Step 4: Verificar** — `npm run build` + revisión manual: click en la tarjeta abre pestaña; click en botón NO abre pestaña.

- [ ] **Step 5: Commit**
```bash
git add components/marketplace.tsx
git commit -m "feat: open /event/[id] in new tab on event card click"
```

---

## Fuera de M1 (planes siguientes)
- **M2:** tipos P2P-en-vivo + liquidación en el poller.
- **M3:** tipos casa-en-vivo + cuotas in-play (extiende `lib/house-odds.ts` usando la fachada) + suspensión + topes.
- **M4:** enriquecimiento (event_tv cache job, event_stats, highlights) + pulido visual.

## Nota de infraestructura (post-M1)
Registrar en cron-job.org un GET a `/api/cron/sync-live` cada 1 min con `Authorization: Bearer {CRON_SECRET}`.
