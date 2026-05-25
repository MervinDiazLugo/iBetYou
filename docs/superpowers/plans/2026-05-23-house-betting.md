# House Betting Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users bet directly against the platform on featured events using prediction-based decimal odds with a 10% house edge, max 100,000 tokens per bet, for both fantasy and real modes, supporting `direct`, `exact_score`, `score_margin`, `run_line`, and `total_runs` bet types.

**Architecture:** House bets are stored in the existing `bets` table with two new columns (`house_bet boolean`, `house_odds numeric`, `potential_payout numeric`). A new `house_wallet` table holds the platform's reserves. At bet creation the user's stake is deducted and the house pre-reserves its maximum liability (`potential_payout - stake`). On auto-resolution the winner is credited and the house wallet is adjusted accordingly.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase/PostgreSQL, `lib/wallet-utils.ts` patterns (optimistic lock), existing `auto-resolve-finished` route for resolution.

---

## Odds Formula (reference for all tasks)

**Direct bets** (home / draw / away):
- Parse prediction `percent` strings: `"55%"` → `0.55`
- Apply 10% overround: `implied_i = trueProbability_i × 1.10`
- Decimal odds: `odds_i = 1 / implied_i`
- `potential_payout = stake × odds_i` (includes returned stake)

**Exact score bets** — **DYNAMIC odds via Poisson model** (zero API cost):
- Football: use `home_goals_avg` + `away_goals_avg` already in event metadata (from predictions API)
  - `P(home=h, away=a) = Poisson(h, λ_home) × Poisson(a, λ_away)`
  - Apply 10% edge: `odds = 1 / (P × 1.10)` · Capped at 150x max
  - Common scores (1-0 ~13%) → ~7x · Rare (4-2 ~1%) → ~90x — house always wins in EV
- Baseball: conservative fixed 15x (implied prob 6.7%; true exact score prob ~3–5% → house has edge)
- Basketball: exact_score not supported → use **`score_margin`** instead (already implemented in P2P system)

**House bet types per sport:**
| Sport | Bet types available |
|---|---|
| Football | `direct`, `exact_score` |
| Baseball | `direct`, `exact_score`, `run_line`, `total_runs` |
| Basketball | `direct`, `score_margin` |

**Score margin house odds** (fixed, 10% edge, NBA margin distribution):
| Selection | True prob | House odds |
|---|---|---|
| Win by 1–5 pts | ~22% | 4.1x |
| Win by 6–10 pts | ~20% | 4.5x |
| Win by 11–15 pts | ~16% | 5.7x |
| Win by 16+ pts | ~22% | 4.1x |
Exposure limit for score_margin: `MAX_EXACT_EXPOSURE` (200k) per selection per event.

**Run line house odds** (fixed, 10% edge — MLB run line ≈ 50/50 by design):
- Both sides (`home_rl`, `away_rl`): **1.82x** → `1/(0.50 × 1.10)`
- Exposure limit: `MAX_DIRECT_EXPOSURE` (500k) per side per event

**Total runs house odds** (fixed table, 10% edge, based on MLB ~8.5 avg runs/game):
| Selection | True prob | House odds |
|---|---|---|
| over_7 | ~65% | 1.40x |
| under_7 | ~35% | 2.60x |
| over_8 | ~55% | 1.65x |
| under_8 | ~45% | 2.02x |
| over_9 | ~40% | 2.27x |
| under_9 | ~60% | 1.52x |
| over_10 | ~30% | 3.03x |
| under_10 | ~70% | 1.30x |
Exposure limit: `MAX_EXACT_EXPOSURE` (200k) per selection per event.

**Why not fixed 12x for football:** implies 8.3% probability. Common scores (1-0, 1-1, 2-1) have true prob 10–15% → users get +EV, house loses systematically.
**Why not Claude:** zero tokens needed — Poisson is deterministic and uses data already in DB.

**Exposure limits** (per event per outcome):
- Direct bets: max 500,000 tokens reserved liability per outcome (home/draw/away) per event
- Exact score: max 200,000 tokens reserved liability per specific score selection per event
- Checked at bet creation — rejects if limit would be exceeded

**House wallet flow:**
- Create: user wallet `-= stake`, house wallet `-= (potential_payout - stake)` [reserve liability]
- User wins: user wallet `+= potential_payout` (house loss absorbed from reservation)
- User loses: house wallet `+= potential_payout` (reclaims reservation + collects stake)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `lib/house-odds.ts` | Direct odds calc + exposure constants |
| Create | `lib/house-wallet.ts` | House wallet debit/credit with optimistic lock |
| Create | `app/api/bets/house/route.ts` | POST — create house bet (+ exposure check) |
| Create | `app/api/bets/house/odds/route.ts` | GET — dynamic odds for exact_score via Claude |
| Create | `app/api/admin/house-wallet/route.ts` | GET view + PATCH fund/withdraw + per-event exposure |
| Modify | `types/index.ts` | Extend Bet + add HouseWallet interface |
| Modify | `app/api/admin/bets/auto-resolve-finished/route.ts` | House bet resolution branch |
| Modify | `components/marketplace.tsx` | House bet button + modal on featured cards |
| Modify | `app/backoffice/house-wallet/page.tsx` (create) | Admin house wallet management page |

---

## Task 1: Database Migration

**Files:**
- Supabase SQL console (no file created)

- [ ] **Step 1: Run migration in Supabase SQL console**

```sql
-- Add house bet columns to bets
ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS house_bet boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS house_odds numeric,
  ADD COLUMN IF NOT EXISTS potential_payout numeric;

-- House wallet table (single row, id=1)
CREATE TABLE IF NOT EXISTS house_wallet (
  id int PRIMARY KEY DEFAULT 1,
  balance_fantasy numeric NOT NULL DEFAULT 0,
  balance_real numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the single wallet row
INSERT INTO house_wallet (id, balance_fantasy, balance_real)
VALUES (1, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Index for fast house bet queries in auto-resolve
CREATE INDEX IF NOT EXISTS idx_bets_house_bet ON bets(house_bet) WHERE house_bet = true;
```

- [ ] **Step 2: Verify in Supabase table editor**
  - `bets` table shows `house_bet`, `house_odds`, `potential_payout` columns
  - `house_wallet` table exists with one row (id=1)

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "chore: add house_bet columns and house_wallet table migration"
```

---

## Task 2: `lib/house-odds.ts`

**Files:**
- Create: `lib/house-odds.ts`

- [ ] **Step 1: Create the file**

```typescript
const HOUSE_EDGE = 1.10
const MAX_EXACT_SCORE_ODDS = 150
// Conservative fixed odds for baseball exact score (implied 6.7%; true ~3-5% → house has edge)
const BASEBALL_EXACT_SCORE_ODDS = 15.0

// Exposure limits: max reserved liability per outcome per event
export const MAX_DIRECT_EXPOSURE = 500_000    // per home/draw/away outcome
export const MAX_EXACT_EXPOSURE = 200_000     // per specific score selection

type PredictionPercent = {
  home: string
  away: string
  draw?: string
}

export type DirectOutcome = "home" | "draw" | "away"

export interface HouseOddsResult {
  home: number
  draw?: number
  away: number
}

function parsePercent(value: string): number {
  return parseFloat(value.replace("%", "")) / 100
}

/**
 * Calculates decimal odds for direct bets from prediction percentages.
 * Applies 10% overround so sum of implied probabilities = 1.10.
 * Returns null if predictions are missing or invalid.
 */
export function calcDirectOdds(percent: PredictionPercent): HouseOddsResult | null {
  const home = parsePercent(percent.home)
  const away = parsePercent(percent.away)
  const draw = percent.draw !== undefined ? parsePercent(percent.draw) : undefined

  if (!Number.isFinite(home) || !Number.isFinite(away) || home <= 0 || away <= 0) return null
  if (draw !== undefined && !Number.isFinite(draw)) return null

  return {
    home: parseFloat((1 / (home * HOUSE_EDGE)).toFixed(4)),
    away: parseFloat((1 / (away * HOUSE_EDGE)).toFixed(4)),
    ...(draw !== undefined ? { draw: parseFloat((1 / (draw * HOUSE_EDGE)).toFixed(4)) } : {}),
  }
}

/**
 * Returns the decimal odds for the chosen outcome.
 * Returns null if the outcome is not available (e.g. "draw" for baseball).
 */
export function oddsForOutcome(odds: HouseOddsResult, outcome: DirectOutcome): number | null {
  if (outcome === "home") return odds.home
  if (outcome === "away") return odds.away
  if (outcome === "draw") return odds.draw ?? null
  return null
}

// ── Exact score: Poisson model for football ───────────────────────────────────

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

function parseScore(selection: string): { home: number; away: number } | null {
  const m = selection.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/)
  if (!m) return null
  return { home: Number(m[1]), away: Number(m[2]) }
}

/**
 * Computes exact_score house odds using Poisson for football (uses goals averages from metadata).
 * For baseball: returns conservative fixed odds (15x).
 * For basketball: returns null (not supported).
 *
 * metadata should contain predictions.home_goals_avg and predictions.away_goals_avg for football.
 */
// ── Run line odds (baseball) ─────────────────────────────────────────────────

const RUN_LINE_ODDS = 1.82 // MLB run line ≈ 50/50; 1/(0.50 × 1.10)

/**
 * Returns fixed decimal odds for run_line bets (baseball only).
 * selection: "home_rl" | "away_rl"
 */
export function calcRunLineOdds(selection: string): number | null {
  if (selection !== "home_rl" && selection !== "away_rl") return null
  return RUN_LINE_ODDS
}

// ── Total runs odds (baseball) ────────────────────────────────────────────────

const TOTAL_RUNS_ODDS: Record<string, number> = {
  over_7: 1.40,
  under_7: 2.60,
  over_8: 1.65,
  under_8: 2.02,
  over_9: 2.27,
  under_9: 1.52,
  over_10: 3.03,
  under_10: 1.30,
}

/**
 * Returns calibrated decimal odds for total_runs bets (baseball only).
 * selection: "over_7" | "under_7" | "over_8" | "under_8" | "over_9" | "under_9" | "over_10" | "under_10"
 */
export function calcTotalRunsOdds(selection: string): number | null {
  return TOTAL_RUNS_ODDS[selection] ?? null
}

// ── Score margin odds (basketball) ───────────────────────────────────────────

const SCORE_MARGIN_ODDS: Record<string, number> = {
  "1_5":    4.1,
  "6_10":   4.5,
  "11_15":  5.7,
  "16plus": 4.1,
}

/**
 * Returns fixed decimal odds for a score_margin selection (basketball only).
 * selection format: "home_1_5" | "home_6_10" | "home_11_15" | "home_16plus" | "away_..."
 */
export function calcScoreMarginOdds(selection: string): number | null {
  const parts = selection.split("_")
  if (parts.length < 2) return null
  const team = parts[0]
  if (team !== "home" && team !== "away") return null
  const rangeKey = parts.slice(1).join("_")
  return SCORE_MARGIN_ODDS[rangeKey] ?? null
}

export function calcExactScoreOdds(
  sport: string,
  selection: string,
  metadata?: Record<string, any>
): number | null {
  if (sport === "basketball") return null

  if (sport === "baseball") return BASEBALL_EXACT_SCORE_ODDS

  // football — Poisson model
  const score = parseScore(selection)
  if (!score) return null

  const lambdaHome = parseFloat(metadata?.predictions?.home_goals_avg ?? "0")
  const lambdaAway = parseFloat(metadata?.predictions?.away_goals_avg ?? "0")

  if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway) || lambdaHome <= 0 || lambdaAway <= 0) {
    // No goal averages → can't price exact_score safely; caller must reject the bet
    return null
  }

  const prob = poissonPmf(score.home, lambdaHome) * poissonPmf(score.away, lambdaAway)
  if (!prob || prob <= 0) return MAX_EXACT_SCORE_ODDS

  const odds = 1 / (prob * HOUSE_EDGE)
  return parseFloat(Math.min(odds, MAX_EXACT_SCORE_ODDS).toFixed(2))
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors from `lib/house-odds.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/house-odds.ts
git commit -m "feat: add house-odds calculator with 10% edge"
```

---

## Task 3: `lib/house-wallet.ts`

**Files:**
- Create: `lib/house-wallet.ts`

- [ ] **Step 1: Create the file**

```typescript
import { createAdminSupabaseClient } from "@/lib/supabase"

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

/**
 * Deducts `amount` from the house wallet for the given mode.
 * Used at house bet creation to reserve the maximum liability.
 * Throws if balance is insufficient or after 3 optimistic-lock retries.
 */
export async function houseWalletDebit(
  supabase: AdminClient,
  amount: number,
  mode: "fantasy" | "real"
): Promise<void> {
  const field = mode === "real" ? "balance_real" : "balance_fantasy"
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: w } = await supabase
      .from("house_wallet")
      .select(field)
      .eq("id", 1)
      .single()
    if (!w) throw new Error("house_wallet row not found")
    const current = Number((w as any)[field])
    if (current < amount) throw new Error(`Casa sin fondos suficientes (${mode})`)
    const { data: updated } = await supabase
      .from("house_wallet")
      .update({ [field]: current - amount, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .eq(field, current)
      .select("id")
    if (updated && updated.length > 0) return
  }
  throw new Error("houseWalletDebit: failed after 3 attempts")
}

/**
 * Credits `amount` to the house wallet for the given mode.
 * Used when the user loses a house bet (house collects stake + reclaims reservation).
 */
export async function houseWalletCredit(
  supabase: AdminClient,
  amount: number,
  mode: "fantasy" | "real"
): Promise<void> {
  const field = mode === "real" ? "balance_real" : "balance_fantasy"
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: w } = await supabase
      .from("house_wallet")
      .select(field)
      .eq("id", 1)
      .single()
    if (!w) throw new Error("house_wallet row not found")
    const current = Number((w as any)[field])
    const { data: updated } = await supabase
      .from("house_wallet")
      .update({ [field]: current + amount, updated_at: new Date().toISOString() })
      .eq("id", 1)
      .eq(field, current)
      .select("id")
    if (updated && updated.length > 0) return
  }
  throw new Error("houseWalletCredit: failed after 3 attempts")
}

/**
 * Returns current house wallet balances.
 */
export async function getHouseWalletBalances(
  supabase: AdminClient
): Promise<{ balance_fantasy: number; balance_real: number }> {
  const { data, error } = await supabase
    .from("house_wallet")
    .select("balance_fantasy, balance_real")
    .eq("id", 1)
    .single()
  if (error || !data) throw new Error("house_wallet not found")
  return { balance_fantasy: Number(data.balance_fantasy), balance_real: Number(data.balance_real) }
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/house-wallet.ts
git commit -m "feat: add house-wallet debit/credit helpers"
```

---

## Task 4: Update `types/index.ts`

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Extend Bet interface and add HouseWallet type**

In `types/index.ts`, update the `Bet` interface — add after `winner_id`:

```typescript
  house_bet?: boolean
  house_odds?: number | null
  potential_payout?: number | null
```

Add at the end of the file:

```typescript
export interface HouseWallet {
  id: number
  balance_fantasy: number
  balance_real: number
  updated_at: string
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: extend Bet type with house fields, add HouseWallet interface"
```

---

## Task 5: `POST /api/bets/house`

**Files:**
- Create: `app/api/bets/house/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase"
import { canCountryUseRealMoney } from "@/lib/country-access"
import { calcDirectOdds, calcExactScoreOdds, calcScoreMarginOdds, calcRunLineOdds, calcTotalRunsOdds, oddsForOutcome, DirectOutcome, MAX_DIRECT_EXPOSURE, MAX_EXACT_EXPOSURE } from "@/lib/house-odds"
import { houseWalletDebit } from "@/lib/house-wallet"
import { payoutToMode } from "@/lib/wallet-utils"
import { createNotification } from "@/lib/notifications"
import { canCountryUseHouseBetting } from "@/lib/country-access"

const MAX_STAKE = 100_000

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, eventId, betType, selection, amount: rawAmount, mode: rawMode } = body

    if (rawMode !== "real" && rawMode !== "fantasy" && rawMode !== undefined && rawMode !== null) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
    }
    const betMode = rawMode === "real" ? "real" : "fantasy"

    const authHeader = request.headers.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const token = authHeader.slice(7)
    const serverSupabase = createServerSupabaseClient()
    const { data: { user }, error: authError } = await serverSupabase.auth.getUser(token)
    if (authError || !user || userId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!eventId || !betType || !selection || rawAmount === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // run_line priced at 50/50 (1.82x) — only valid for MLB where that holds empirically.
    // LATAM leagues (LVBP, etc.) can be highly unbalanced, making 1.82x -EV for the house.
    const MLB_LEAGUE_KEYWORDS = ["mlb", "major league baseball", "american league", "national league"]
    const isMLBLeague = MLB_LEAGUE_KEYWORDS.some(kw => eventRow.league?.toLowerCase().includes(kw))

    const ALLOWED_BET_TYPES: Record<string, string[]> = {
      football:   ["direct", "exact_score"],
      basketball: ["direct", "score_margin"],
      baseball:   isMLBLeague
        ? ["direct", "exact_score", "run_line", "total_runs"]
        : ["direct", "exact_score", "total_runs"],  // run_line excluded for non-MLB
    }
    const allowedForSport = ALLOWED_BET_TYPES[eventRow.sport] ?? ["direct"]
    if (!allowedForSport.includes(betType)) {
      const hint = betType === "run_line" && eventRow.sport === "baseball" && !isMLBLeague
        ? "Run Line solo está disponible para ligas MLB"
        : `Casa no acepta "${betType}" para ${eventRow.sport}`
      return NextResponse.json({ error: hint }, { status: 400 })
    }

    const stake = Number(rawAmount)
    if (!Number.isFinite(stake) || stake <= 0) {
      return NextResponse.json({ error: "El monto debe ser un número positivo" }, { status: 400 })
    }
    if (stake > MAX_STAKE) {
      return NextResponse.json({ error: `Máximo ${MAX_STAKE.toLocaleString("es-ES")} tokens por apuesta` }, { status: 400 })
    }

    const supabase = createAdminSupabaseClient()

    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select("id, sport, status, featured, metadata")
      .eq("id", eventId)
      .single()

    if (eventError || !eventRow) {
      return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 })
    }
    if (!eventRow.featured) {
      return NextResponse.json({ error: "Solo se puede apostar contra la casa en eventos destacados" }, { status: 400 })
    }
    if (eventRow.status === "finished" || eventRow.status === "cancelled" || eventRow.status === "postponed") {
      return NextResponse.json({ error: "Este evento no acepta nuevas apuestas" }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, is_banned, role, betting_blocked_until, country")
      .eq("id", user.id)
      .single()

    if (profile?.is_banned) {
      return NextResponse.json({ error: "User is banned from betting" }, { status: 403 })
    }
    if (profile?.role === "backoffice_admin") {
      return NextResponse.json({ error: "Los usuarios de backoffice no pueden crear apuestas" }, { status: 403 })
    }
    if (profile?.betting_blocked_until && new Date(profile.betting_blocked_until) > new Date()) {
      return NextResponse.json({ error: `No puedes apostar hasta ${new Date(profile.betting_blocked_until).toLocaleString("es-ES")}` }, { status: 403 })
    }
    const houseAllowed = await canCountryUseHouseBetting(profile?.country ?? null)
    if (!houseAllowed) {
      return NextResponse.json({ error: "Las apuestas contra la Casa no están habilitadas en tu país" }, { status: 403 })
    }

    if (betMode === "real") {
      const allowed = await canCountryUseRealMoney(profile?.country ?? null)
      if (!allowed) {
        return NextResponse.json({ error: "El Modo Real no está habilitado en tu país" }, { status: 403 })
      }
    }

    // Calculate odds — must validate event sport before this block
    let houseOdds: number | null = null

    if (betType === "direct") {
      const predictions = (eventRow.metadata as any)?.predictions
      if (!predictions?.percent) {
        return NextResponse.json({ error: "Este evento no tiene predicciones disponibles para apostar contra la casa" }, { status: 400 })
      }
      const oddsResult = calcDirectOdds(predictions.percent)
      if (!oddsResult) {
        return NextResponse.json({ error: "No se pudieron calcular las cuotas para este evento" }, { status: 400 })
      }
      houseOdds = oddsForOutcome(oddsResult, selection as DirectOutcome)
      if (houseOdds === null) {
        return NextResponse.json({ error: `La selección "${selection}" no está disponible para este evento` }, { status: 400 })
      }
    } else if (betType === "exact_score") {
      if (!/^\d+\s*[-:]\s*\d+$/.test(String(selection))) {
        return NextResponse.json({ error: "Formato de marcador inválido. Ejemplo: 2-1" }, { status: 400 })
      }
      houseOdds = calcExactScoreOdds(eventRow.sport, String(selection), eventRow.metadata as any)
      if (houseOdds === null) {
        return NextResponse.json({ error: "Marcador exacto no disponible para este deporte" }, { status: 400 })
      }
    } else if (betType === "score_margin") {
      houseOdds = calcScoreMarginOdds(String(selection))
      if (houseOdds === null) {
        return NextResponse.json({ error: `Selección de margen inválida: "${selection}"` }, { status: 400 })
      }
    } else if (betType === "run_line") {
      houseOdds = calcRunLineOdds(String(selection))
      if (houseOdds === null) {
        return NextResponse.json({ error: `Selección de run_line inválida: "${selection}"` }, { status: 400 })
      }
    } else if (betType === "total_runs") {
      houseOdds = calcTotalRunsOdds(String(selection))
      if (houseOdds === null) {
        return NextResponse.json({ error: `Selección de total_runs inválida: "${selection}"` }, { status: 400 })
      }
    }

    const potentialPayout = parseFloat((stake * houseOdds).toFixed(4))
    const houseRisk = parseFloat((potentialPayout - stake).toFixed(4))

    // Exposure limit check — prevent correlated bet concentration per outcome
    const exposureLimit = betType === "direct" || betType === "run_line"
      ? MAX_DIRECT_EXPOSURE
      : MAX_EXACT_EXPOSURE
    const { data: exposureRows } = await supabase
      .from("bets")
      .select("potential_payout, amount")
      .eq("event_id", eventId)
      .eq("creator_selection", String(selection))
      .eq("house_bet", true)
      .eq("status", "taken")
    const currentExposure = (exposureRows || []).reduce((sum, b) => sum + (Number(b.potential_payout) - Number(b.amount)), 0)
    if (currentExposure + houseRisk > exposureLimit) {
      return NextResponse.json({
        error: `Límite de exposición alcanzado para esta selección. La casa no puede aceptar más apuestas en "${selection}" para este evento.`,
      }, { status: 400 })
    }

    // Check user balance
    let userBalance: number
    if (betMode === "real") {
      const { data: ibcWallet } = await supabase
        .from("iby_wallets")
        .select("balance, balance_blocked")
        .eq("user_id", user.id)
        .single()
      if (!ibcWallet) return NextResponse.json({ error: "iBY wallet not found" }, { status: 404 })
      const available = Number(ibcWallet.balance) - Number(ibcWallet.balance_blocked)
      if (available < stake) return NextResponse.json({ error: "Saldo iBY insuficiente" }, { status: 400 })
      userBalance = Number(ibcWallet.balance)
    } else {
      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance_fantasy")
        .eq("user_id", user.id)
        .single()
      if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 })
      if (wallet.balance_fantasy < stake) return NextResponse.json({ error: "Saldo insuficiente" }, { status: 400 })
      userBalance = wallet.balance_fantasy
    }

    // Deduct stake from user (optimistic lock)
    if (betMode === "real") {
      const { data: updated } = await supabase
        .from("iby_wallets")
        .update({ balance: userBalance - stake })
        .eq("user_id", user.id)
        .eq("balance", userBalance)
        .select("user_id")
      if (!updated || updated.length === 0) {
        return NextResponse.json({ error: "Tu saldo cambió. Recarga e intenta de nuevo." }, { status: 409 })
      }
    } else {
      const { data: updated } = await supabase
        .from("wallets")
        .update({ balance_fantasy: userBalance - stake })
        .eq("user_id", user.id)
        .eq("balance_fantasy", userBalance)
        .select("user_id")
      if (!updated || updated.length === 0) {
        return NextResponse.json({ error: "Tu saldo cambió. Recarga e intenta de nuevo." }, { status: 409 })
      }
    }

    // Reserve house liability
    try {
      await houseWalletDebit(supabase, houseRisk, betMode)
    } catch (e: any) {
      // Rollback user deduction
      try { await payoutToMode(supabase, user.id, stake, betMode) } catch (_) {}
      return NextResponse.json({ error: e.message || "Casa sin fondos" }, { status: 400 })
    }

    // Create bet — status 'taken' immediately, no acceptor
    const { data: bet, error: betError } = await supabase
      .from("bets")
      .insert({
        event_id: eventId,
        creator_id: user.id,
        acceptor_id: null,
        type: betType === "exact_score" ? "asymmetric" : "symmetric",
        bet_type: betType,
        selection: JSON.stringify({ selection }),
        creator_selection: String(selection),
        amount: stake,
        multiplier: betType === "exact_score" ? houseOdds : 1,
        fee_amount: 0,
        status: "taken",
        mode: betMode,
        house_bet: true,
        house_odds: houseOdds,
        potential_payout: potentialPayout,
      })
      .select()
      .single()

    if (betError) {
      // Rollback both deductions
      try { await payoutToMode(supabase, user.id, stake, betMode) } catch (_) {}
      try { await houseWalletCredit(supabase, houseRisk, betMode) } catch (_) {}
      return NextResponse.json({ error: `No se pudo crear la apuesta: ${betError.message}` }, { status: 400 })
    }

    await supabase.from("transactions").insert({
      user_id: user.id,
      token_type: betMode === "real" ? "iBY" : "fantasy",
      amount: -stake,
      operation: "house_bet_created",
      reference_id: bet.id,
    })

    await createNotification({
      userId: user.id,
      type: "bet_created",
      title: "Apuesta vs. Casa creada",
      body: `Apostaste ${stake.toLocaleString("es-ES")} ${betMode === "real" ? "iBY" : "Fantasy Tokens"}. Ganancia potencial: ${potentialPayout.toFixed(0)}.`,
      betId: bet.id,
    }, supabase)

    return NextResponse.json({
      success: true,
      bet: { id: bet.id, status: bet.status, house_odds: houseOdds, potential_payout: potentialPayout },
    })
  } catch (error) {
    console.error("Create house bet error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Manual API test (curl)**

Requires a valid session token. Start dev server: `npm run dev`.

```bash
curl -X POST http://localhost:3000/api/bets/house \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"userId":"<uid>","eventId":1,"betType":"direct","selection":"home","amount":100,"mode":"fantasy"}'
```

Expected: `{"success":true,"bet":{"id":"...","status":"taken","house_odds":...,"potential_payout":...}}`

Test error cases:
- `amount: 200000` → should return 400 with max tokens message
- `betType: "half_time"` → should return 400 with unsupported type message
- Non-featured event → should return 400 with featured-only message

- [ ] **Step 4: Commit**

```bash
git add app/api/bets/house/route.ts
git commit -m "feat: POST /api/bets/house — create house bet with odds, Poisson pricing, exposure check"
```

---

## Task 5.5: `GET /api/bets/house/odds` — dynamic odds endpoint for UI

**Files:**
- Create: `app/api/bets/house/odds/route.ts`

Used by the marketplace modal to show odds **before** the user submits. Called with query params: `?eventId=X&betType=direct` or `?eventId=X&betType=exact_score&selection=2-1`.

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { calcDirectOdds, calcExactScoreOdds, calcScoreMarginOdds, calcRunLineOdds, calcTotalRunsOdds } from "@/lib/house-odds"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const eventId = Number(searchParams.get("eventId"))
  const betType = searchParams.get("betType")
  const selection = searchParams.get("selection") ?? ""

  if (!Number.isFinite(eventId) || !betType) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()
  const { data: ev } = await supabase
    .from("events")
    .select("sport, featured, metadata")
    .eq("id", eventId)
    .single()

  if (!ev || !ev.featured) {
    return NextResponse.json({ error: "Evento no disponible" }, { status: 404 })
  }

  if (betType === "direct") {
    const predictions = (ev.metadata as any)?.predictions
    if (!predictions?.percent) {
      return NextResponse.json({ error: "Sin predicciones" }, { status: 400 })
    }
    const odds = calcDirectOdds(predictions.percent)
    if (!odds) return NextResponse.json({ error: "No se pudieron calcular cuotas" }, { status: 400 })
    return NextResponse.json({ odds })
  }

  if (betType === "exact_score") {
    if (!selection) return NextResponse.json({ error: "Falta la selección" }, { status: 400 })
    const odds = calcExactScoreOdds(ev.sport, selection, ev.metadata as any)
    if (odds === null) return NextResponse.json({ error: "No disponible para este deporte" }, { status: 400 })
    return NextResponse.json({ odds })
  }

  if (betType === "score_margin") {
    if (!selection) return NextResponse.json({ error: "Falta la selección" }, { status: 400 })
    const odds = calcScoreMarginOdds(selection)
    if (odds === null) return NextResponse.json({ error: "Selección de margen inválida" }, { status: 400 })
    return NextResponse.json({ odds })
  }

  if (betType === "run_line") {
    if (!selection) return NextResponse.json({ error: "Falta la selección" }, { status: 400 })
    const odds = calcRunLineOdds(selection)
    if (odds === null) return NextResponse.json({ error: "Selección de run_line inválida" }, { status: 400 })
    return NextResponse.json({ odds })
  }

  if (betType === "total_runs") {
    if (!selection) return NextResponse.json({ error: "Falta la selección" }, { status: 400 })
    const odds = calcTotalRunsOdds(selection)
    if (odds === null) return NextResponse.json({ error: "Selección de total_runs inválida" }, { status: 400 })
    return NextResponse.json({ odds })
  }

  return NextResponse.json({ error: "betType inválido" }, { status: 400 })
}
```

- [ ] **Step 2: Test manually**

```bash
curl "http://localhost:3000/api/bets/house/odds?eventId=1&betType=direct"
# → { "odds": { "home": 1.64, "draw": 3.21, "away": 4.88 } }

curl "http://localhost:3000/api/bets/house/odds?eventId=1&betType=exact_score&selection=1-0"
# → { "odds": 7.8 }   (Poisson from goals averages, with 10% edge)

curl "http://localhost:3000/api/bets/house/odds?eventId=1&betType=exact_score&selection=5-4"
# → { "odds": 150 }   (rare score, capped at MAX_EXACT_SCORE_ODDS)
```

- [ ] **Step 3: Commit**

```bash
git add app/api/bets/house/odds/route.ts
git commit -m "feat: GET /api/bets/house/odds — dynamic odds endpoint for marketplace UI"
```

---

## Task 6: `GET + PATCH /api/admin/house-wallet`

**Files:**
- Create: `app/api/admin/house-wallet/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { getHouseWalletBalances } from "@/lib/house-wallet"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  try {
    const balances = await getHouseWalletBalances(supabase)

    // Active house bets with per-event exposure breakdown
    const { data: active } = await supabase
      .from("bets")
      .select("mode, amount, potential_payout, event_id, creator_selection, bet_type, event:events(home_team, away_team)")
      .eq("house_bet", true)
      .eq("status", "taken")
      .order("created_at", { ascending: false })
      .limit(500)

    const summary = {
      active_fantasy: 0,
      active_real: 0,
      reserved_liability_fantasy: 0,
      reserved_liability_real: 0,
    }

    // Group by event+outcome to show concentration risk
    const exposureByEvent: Record<string, {
      event_id: number
      match: string
      outcome: string
      bet_type: string
      count: number
      liability: number
      mode: string
    }> = {}

    for (const b of active || []) {
      const payout = Number(b.potential_payout || 0)
      const stake = Number(b.amount || 0)
      const risk = payout - stake
      if (b.mode === "real") {
        summary.active_real++
        summary.reserved_liability_real += risk
      } else {
        summary.active_fantasy++
        summary.reserved_liability_fantasy += risk
      }

      const ev = Array.isArray((b as any).event) ? (b as any).event[0] : (b as any).event
      const match = ev ? `${ev.home_team} vs ${ev.away_team}` : `Event ${b.event_id}`
      const key = `${b.event_id}_${b.creator_selection}_${b.mode}`
      if (!exposureByEvent[key]) {
        exposureByEvent[key] = { event_id: b.event_id, match, outcome: b.creator_selection, bet_type: b.bet_type, count: 0, liability: 0, mode: b.mode }
      }
      exposureByEvent[key].count++
      exposureByEvent[key].liability += risk
    }

    const topExposure = Object.values(exposureByEvent)
      .sort((a, b) => b.liability - a.liability)
      .slice(0, 20)

    const LOW_BALANCE_THRESHOLD = 500_000
    const alerts: string[] = []
    if (balances.balance_fantasy < LOW_BALANCE_THRESHOLD) {
      alerts.push(`Casa fantasy baja (${balances.balance_fantasy.toLocaleString()} tokens). Recarga recomendada.`)
    }
    if (balances.balance_real < LOW_BALANCE_THRESHOLD) {
      alerts.push(`Casa real baja (${balances.balance_real.toLocaleString()} iBY). Recarga recomendada.`)
    }

    return NextResponse.json({ ...balances, ...summary, top_exposure: topExposure, alerts })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  try {
    const { mode, amount: rawAmount, operation } = await request.json()

    if (mode !== "fantasy" && mode !== "real") {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
    }
    if (operation !== "fund" && operation !== "withdraw") {
      return NextResponse.json({ error: "operation must be 'fund' or 'withdraw'" }, { status: 400 })
    }

    const amount = Number(rawAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
    }

    const field = mode === "real" ? "balance_real" : "balance_fantasy"

    const { data: w } = await supabase
      .from("house_wallet")
      .select(field)
      .eq("id", 1)
      .single()
    if (!w) return NextResponse.json({ error: "house_wallet not found" }, { status: 500 })

    const current = Number((w as any)[field])
    const delta = operation === "fund" ? amount : -amount

    if (operation === "withdraw" && current < amount) {
      return NextResponse.json({ error: "Saldo insuficiente para retirar" }, { status: 400 })
    }

    const { error: updateErr } = await supabase
      .from("house_wallet")
      .update({ [field]: current + delta, updated_at: new Date().toISOString() })
      .eq("id", 1)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    return NextResponse.json({ success: true, [field]: current + delta })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/house-wallet/route.ts
git commit -m "feat: GET/PATCH /api/admin/house-wallet — view and fund house reserves"
```

---

## Task 7: Extend auto-resolve-finished to handle house bets

**Files:**
- Modify: `app/api/admin/bets/auto-resolve-finished/route.ts`

- [ ] **Step 1: Add imports at top of the file**

After the existing imports, add:

```typescript
import { houseWalletCredit } from "@/lib/house-wallet"
```

- [ ] **Step 2: Replace the payout block after `const { winnerId, reason } = resolution`**

Find the existing block (around line 406–492) that starts with `const totalPrize = calculateTotalPrize(...)`. Replace it with:

```typescript
      const isHouseBet = Boolean((bet as any).house_bet)
      const betMode = (bet as any).mode ?? "fantasy"

      // Push scenario: total_runs exact threshold — no winner, return stakes
      // winnerId is null when resolver explicitly signals a push (resolveTotalRuns returns null)
      if (winnerId === null) {
        if (dryRun) {
          results.push({ bet_id: (bet as any).id, bet_type: betType, status: "would_push", reason })
          continue
        }
        const { error: pushErr } = await supabase
          .from("bets")
          .update({ status: "cancelled", resolved_at: new Date().toISOString() })
          .eq("id", (bet as any).id)
          .in("status", ["taken"])
        if (!pushErr) {
          const stake = Number((bet as any).amount || 0)
          const houseRisk = Number((bet as any).potential_payout || 0) - stake
          // Return stake to user
          try { await payoutToMode(supabase, (bet as any).creator_id, stake, betMode) } catch (_) {}
          // Return reserved liability to house
          try { await houseWalletCredit(supabase, houseRisk, betMode) } catch (_) {}
          await supabase.from("arbitration_decisions").insert({
            bet_id: (bet as any).id,
            action: `auto_resolve_push_${betType}`,
            previous_status: (bet as any).status,
            new_status: "cancelled",
            decided_winner_id: null,
            reason,
            details: { bet_type: betType, house_bet: isHouseBet, push: true },
            decided_by: decidedBy,
            source: "system",
          })
          await createNotifications([{
            userId: (bet as any).creator_id,
            type: "bet_cancelled",
            title: "Apuesta devuelta (empate técnico)",
            body: `Tu apuesta de ${betType} terminó en empate técnico. Tu stake fue devuelto.`,
            betId: (bet as any).id,
            mode: betMode,
          }], supabase)
          resolved += 1
          results.push({ bet_id: (bet as any).id, bet_type: betType, status: "pushed", reason })
        } else {
          failed += 1
          results.push({ bet_id: (bet as any).id, status: "failed", reason: pushErr.message })
        }
        continue
      }

      if (dryRun) {
        resolved += 1
        const prize = isHouseBet
          ? Number((bet as any).potential_payout)
          : calculateTotalPrize((bet as any).amount || 0, (bet as any).multiplier || 1)
        results.push({
          bet_id: (bet as any).id,
          bet_type: betType,
          house_bet: isHouseBet,
          status: "would_resolve",
          winner_id: winnerId,
          reason,
          total_prize: prize,
        })
        continue
      }

      const { data: updatedBet, error: updateError } = await supabase
        .from("bets")
        .update({ status: "resolved", winner_id: winnerId, resolved_at: new Date().toISOString() })
        .eq("id", (bet as any).id)
        .in("status", ["taken", "disputed"])
        .is("resolved_at", null)
        .select("id")
        .single()

      if (updateError || !updatedBet) {
        failed += 1
        results.push({ bet_id: (bet as any).id, status: "failed", reason: updateError?.message || "No se pudo actualizar" })
        continue
      }

      if (isHouseBet) {
        const potentialPayout = Number((bet as any).potential_payout || 0)
        const stake = Number((bet as any).amount || 0)
        const userWon = winnerId === (bet as any).creator_id

        if (userWon) {
          // Pay user their winnings — house loses the reserved liability (already debited at creation)
          try {
            await payoutToMode(supabase, winnerId, potentialPayout, betMode)
          } catch (payoutErr) {
            failed += 1
            console.error("HOUSE_BET_PAYOUT_FAILED", { userId: winnerId, amount: potentialPayout, betId: (bet as any).id, error: payoutErr })
            results.push({ bet_id: (bet as any).id, status: "failed", reason: "User payout failed" })
            continue
          }
          await supabase.from("transactions").insert({
            user_id: winnerId,
            token_type: tokenTypeForMode(betMode),
            amount: potentialPayout,
            operation: `house_bet_won_${betType}`,
            reference_id: (bet as any).id,
          })
        } else {
          // User lost — house reclaims reservation + collects stake
          try {
            await houseWalletCredit(supabase, potentialPayout, betMode)
          } catch (creditErr) {
            console.error("HOUSE_WALLET_CREDIT_FAILED", { amount: potentialPayout, betId: (bet as any).id, error: creditErr })
          }
          await supabase.from("transactions").insert({
            user_id: winnerId, // house system marker — use creator_id as reference
            token_type: tokenTypeForMode(betMode),
            amount: -stake,
            operation: `house_bet_lost_${betType}`,
            reference_id: (bet as any).id,
          })
        }

        await supabase.from("arbitration_decisions").insert({
          bet_id: (bet as any).id,
          action: `auto_resolve_finished_${betType}`,
          previous_status: (bet as any).status,
          new_status: "resolved",
          decided_winner_id: winnerId,
          reason,
          details: {
            bet_type: betType,
            house_bet: true,
            creator_selection: extractCreatorSelection({ creator_selection: (bet as any).creator_selection, selection: (bet as any).selection }),
            final_score: `${eventRow.home_score}-${eventRow.away_score}`,
            event_id: (bet as any).event_id,
            house_odds: (bet as any).house_odds,
            potential_payout: potentialPayout,
            user_won: userWon,
          },
          decided_by: decidedBy,
          source: "system",
        })

        const notifTitle = userWon
          ? `¡Ganaste ${potentialPayout.toFixed(0)} ${betMode === "real" ? "iBY" : "Fantasy Tokens"}!`
          : "Perdiste tu apuesta contra la casa"
        const matchInfo = `${eventRow.home_team} vs ${eventRow.away_team}` +
          (eventRow.home_score !== null && eventRow.away_score !== null ? ` (${eventRow.home_score}-${eventRow.away_score})` : "")
        await createNotifications([
          {
            userId: (bet as any).creator_id,
            type: userWon ? "bet_resolved_win" : "bet_resolved_loss",
            title: notifTitle,
            body: matchInfo,
            betId: (bet as any).id,
            mode: betMode,
          },
        ], supabase)

        resolved += 1
        results.push({
          bet_id: (bet as any).id,
          bet_type: betType,
          house_bet: true,
          status: "resolved",
          winner_id: winnerId,
          user_won: userWon,
          reason,
          potential_payout: potentialPayout,
        })
        continue
      }

      // ── Standard P2P resolution ──────────────────────────────────────────────
      const totalPrize = calculateTotalPrize((bet as any).amount || 0, (bet as any).multiplier || 1)

      try {
        await payoutToMode(supabase, winnerId, totalPrize, betMode)
      } catch (payoutErr) {
        failed += 1
        console.error("PAYOUT_FAILED", { userId: winnerId, amount: totalPrize, betId: (bet as any).id, betMode, error: payoutErr })
        results.push({ bet_id: (bet as any).id, status: "failed", reason: "Payout failed after 3 retries" })
        continue
      }
      await supabase.from("transactions").insert({
        user_id: winnerId,
        token_type: tokenTypeForMode(betMode),
        amount: totalPrize,
        operation: `bet_won_auto_resolved_${betType}`,
        reference_id: (bet as any).id,
      })

      await supabase.from("arbitration_decisions").insert({
        bet_id: (bet as any).id,
        action: `auto_resolve_finished_${betType}`,
        previous_status: (bet as any).status,
        new_status: "resolved",
        decided_winner_id: winnerId,
        reason,
        details: {
          bet_type: betType,
          creator_selection: extractCreatorSelection({ creator_selection: (bet as any).creator_selection, selection: (bet as any).selection }),
          final_score: `${eventRow.home_score}-${eventRow.away_score}`,
          event_id: (bet as any).event_id,
        },
        decided_by: decidedBy,
        source: "system",
      })

      const loserId = winnerId === (bet as any).creator_id ? (bet as any).acceptor_id : (bet as any).creator_id
      const matchInfo = `${eventRow.home_team} vs ${eventRow.away_team}` +
        (eventRow.home_score !== null && eventRow.away_score !== null ? ` (${eventRow.home_score}-${eventRow.away_score})` : "")
      await createNotifications([
        { userId: winnerId, type: "bet_resolved_win", title: `¡Ganaste ${totalPrize.toFixed(2)} ${betMode === "real" ? "iBY" : "Fantasy Tokens"}!`, body: matchInfo, betId: (bet as any).id, mode: betMode },
        { userId: loserId, type: "bet_resolved_loss", title: "Perdiste esta apuesta", body: matchInfo, betId: (bet as any).id, mode: betMode },
      ], supabase)

      await updateWageringProgress((bet as any).creator_id, (bet as any).amount, supabase, betMode)
      if ((bet as any).acceptor_id) {
        await updateWageringProgress((bet as any).acceptor_id, (bet as any).amount, supabase, betMode)
      }

      resolved += 1
      results.push({
        bet_id: (bet as any).id,
        bet_type: betType,
        status: "resolved",
        winner_id: winnerId,
        reason,
        total_prize: totalPrize,
      })
```

**Note:** The house bet resolution block now handles `winnerId` differently. For house bets, `acceptor_id` is null, so `winnerId` is always `creator_id` (user wins) or a sentinel value. The resolution functions (`resolveDirect`, `resolveExactScore`) expect a `bet.acceptor_id`. For house bets the acceptor is the house — we need to pass a fallback. See Step 3.

- [ ] **Step 3: Add house bet resolver sentinel at the bet resolution dispatch point**

Find where `betForResolver` is constructed (around line 336):

```typescript
      const betForResolver = {
        creator_id: (bet as any).creator_id as string,
        acceptor_id: (bet as any).acceptor_id as string,
      }
```

Replace with:

```typescript
      const isHouseBet = Boolean((bet as any).house_bet)
      const betForResolver = {
        creator_id: (bet as any).creator_id as string,
        // For house bets acceptor_id is null; use "house" as sentinel so resolver returns creator_id for win
        acceptor_id: (isHouseBet ? "house" : (bet as any).acceptor_id) as string,
      }
```

This means when `resolveDirect` returns `bet.acceptor_id` (user lost), `winnerId` will be `"house"` — a sentinel string. In the house bet payout block above, `userWon = winnerId === (bet as any).creator_id` correctly returns false when winnerId is "house".

- [ ] **Step 4: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/bets/auto-resolve-finished/route.ts lib/house-wallet.ts
git commit -m "feat: handle house bet resolution in auto-resolve-finished"
```

---

## Task 8: Backoffice house wallet page

**Files:**
- Create: `app/backoffice/house-wallet/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client"
import { useState, useEffect } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"

interface HouseWalletData {
  balance_fantasy: number
  balance_real: number
  active_fantasy: number
  active_real: number
  reserved_liability_fantasy: number
  reserved_liability_real: number
  alerts: string[]
  top_exposure: Array<{
    event_id: number
    match: string
    outcome: string
    bet_type: string
    count: number
    liability: number
    mode: string
  }>
}

async function authFetch(input: RequestInfo, init?: RequestInit) {
  const supabase = createBrowserSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init?.headers)
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}

export default function HouseWalletPage() {
  const [data, setData] = useState<HouseWalletData | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState("")
  const [mode, setMode] = useState<"fantasy" | "real">("fantasy")
  const [operation, setOperation] = useState<"fund" | "withdraw">("fund")
  const [submitting, setSubmitting] = useState(false)
  const { showToast } = useToast()

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await authFetch("/api/admin/house-wallet")
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleSubmit = async () => {
    const parsed = Number(amount)
    if (!parsed || parsed <= 0) { showToast("Monto inválido", "error"); return }
    setSubmitting(true)
    try {
      const res = await authFetch("/api/admin/house-wallet", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, amount: parsed, operation }),
      })
      const json = await res.json()
      if (!res.ok) { showToast(json.error || "Error", "error"); return }
      showToast(`${operation === "fund" ? "Fondos añadidos" : "Retiro realizado"} correctamente`, "success")
      setAmount("")
      await loadData()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Wallet de la Casa</h1>

      {data?.alerts && data.alerts.length > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 space-y-1">
          {data.alerts.map((a, i) => (
            <p key={i} className="text-sm text-red-500 font-medium">⚠️ {a}</p>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">Cargando...</p>
      ) : data ? (
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Fantasy</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatCurrency(data.balance_fantasy)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.active_fantasy} apuestas activas · Riesgo: {formatCurrency(data.reserved_liability_fantasy)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Real (iBY)</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatCurrency(data.balance_real)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.active_real} apuestas activas · Riesgo: {formatCurrency(data.reserved_liability_real)}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {data?.top_exposure && data.top_exposure.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Exposición por outcome (activa)</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="pb-2">Partido</th>
                  <th className="pb-2">Selección</th>
                  <th className="pb-2">Modo</th>
                  <th className="pb-2">Apuestas</th>
                  <th className="pb-2 text-right">Riesgo</th>
                </tr>
              </thead>
              <tbody>
                {data.top_exposure.map((row, i) => (
                  <tr key={i} className={row.liability > 300_000 ? "text-red-600 font-medium" : ""}>
                    <td className="py-1 truncate max-w-[180px]">{row.match}</td>
                    <td className="py-1">{row.outcome}</td>
                    <td className="py-1">{row.mode}</td>
                    <td className="py-1">{row.count}</td>
                    <td className="py-1 text-right">{formatCurrency(row.liability)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">
              Filas en rojo: exposición &gt; 300k tokens. Límite por outcome: 500k (direct) / 200k (exact_score).
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Gestionar fondos</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button variant={mode === "fantasy" ? "default" : "outline"} size="sm" onClick={() => setMode("fantasy")}>Fantasy</Button>
            <Button variant={mode === "real" ? "default" : "outline"} size="sm" onClick={() => setMode("real")}>Real (iBY)</Button>
          </div>
          <div className="flex gap-2">
            <Button variant={operation === "fund" ? "default" : "outline"} size="sm" onClick={() => setOperation("fund")}>Añadir fondos</Button>
            <Button variant={operation === "withdraw" ? "destructive" : "outline"} size="sm" onClick={() => setOperation("withdraw")}>Retirar</Button>
          </div>
          <div>
            <Label>Monto</Label>
            <Input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              min={1}
            />
          </div>
          <Button onClick={handleSubmit} disabled={submitting || !amount}>
            {submitting ? "Procesando..." : operation === "fund" ? "Añadir fondos" : "Retirar fondos"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Add link to backoffice nav**

Read `app/backoffice/layout.tsx` (or whatever file has the backoffice sidebar/nav) and add a link to `/backoffice/house-wallet` with label "Wallet Casa".

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Visual test**
  - Navigate to `/backoffice/house-wallet`
  - Fund 10,000 fantasy tokens — balance should update
  - Fund 0 — should show error toast

- [ ] **Step 5: Commit**

```bash
git add app/backoffice/house-wallet/page.tsx
git commit -m "feat: backoffice house wallet management page"
```

---

## Task 9: UI — House bet button + modal in marketplace

**Files:**
- Modify: `components/marketplace.tsx`

This task modifies the existing marketplace component to add a "Apostar vs. Casa" button on featured event cards and a modal for placing house bets.

- [ ] **Step 1: Read `components/marketplace.tsx`**

Read the full file to understand current state structure, event card rendering, and existing modal patterns.

- [ ] **Step 2: Add house bet state**

Near the top of the component's state declarations, add:

```tsx
const [houseBetModal, setHouseBetModal] = useState<{
  event: Event
  odds: { home: number; draw?: number; away: number } | null
} | null>(null)
const [houseBetSelection, setHouseBetSelection] = useState<string | null>(null)
const [houseBetExactScore, setHouseBetExactScore] = useState("")
const [houseBetSelectionOdds, setHouseBetSelectionOdds] = useState<number | null>(null)
const [houseBetType, setHouseBetType] = useState<string>("direct")
const [houseBetAmount, setHouseBetAmount] = useState("")
const [houseBetSubmitting, setHouseBetSubmitting] = useState(false)
```

Add a helper that returns available bet types per sport:
```tsx
function getHouseBetTypes(sport: string): Array<{ id: string; label: string }> {
  if (sport === "football") return [{ id: "direct", label: "Resultado" }, { id: "exact_score", label: "Marcador exacto" }]
  if (sport === "basketball") return [{ id: "direct", label: "Resultado" }, { id: "score_margin", label: "Margen" }]
  if (sport === "baseball") return [
    { id: "direct", label: "Resultado" },
    { id: "run_line", label: "Run Line" },
    { id: "total_runs", label: "Total carreras" },
    { id: "exact_score", label: "Marcador exacto" },
  ]
  return [{ id: "direct", label: "Resultado" }]
}
```

Also add a `useEffect` that fetches odds for text-input bet types (exact_score) when the user types a valid score (debounced 600ms):

```tsx
useEffect(() => {
  if (!houseBetModal) { setHouseBetSelectionOdds(null); return }

  // For types with a predefined selection, odds are derived from houseBetModal.odds or fixed tables
  // Only exact_score requires a dynamic fetch
  if (houseBetType !== "exact_score") {
    setHouseBetSelectionOdds(null)
    return
  }
  const validFormat = /^\d+\s*[-:]\s*\d+$/.test(houseBetExactScore)
  if (!validFormat) { setHouseBetSelectionOdds(null); return }

  const timer = setTimeout(async () => {
    const res = await fetch(
      `/api/bets/house/odds?eventId=${houseBetModal.event.id}&betType=exact_score&selection=${encodeURIComponent(houseBetExactScore)}`
    )
    if (res.ok) {
      const json = await res.json()
      setHouseBetSelectionOdds(Number(json.odds) || null)
    }
  }, 600)
  return () => clearTimeout(timer)
}, [houseBetExactScore, houseBetType, houseBetModal])
```

- [ ] **Step 3: Add odds calculation helper (client-side)**

Import the house-odds module and add a helper that computes odds from an event's predictions. Add a function inside the component or as a module-level helper:

```tsx
import { calcDirectOdds } from "@/lib/house-odds"
import type { HouseOddsResult } from "@/lib/house-odds"

// No EXACT_SCORE_ODDS constant needed — fetched dynamically from /api/bets/house/odds

function getEventOdds(event: Event): HouseOddsResult | null {
  const percent = event.metadata?.predictions?.percent
  if (!percent) return null
  return calcDirectOdds(percent)
}
```

- [ ] **Step 4: Add "Apostar vs. Casa" button on featured event cards**

In the section that renders featured event cards, find the existing buttons (e.g., "Ver apuestas") and add after them:

```tsx
{event.featured && event.metadata?.predictions?.percent && (
  <Button
    variant="outline"
    size="sm"
    className="border-yellow-500 text-yellow-600 hover:bg-yellow-50 text-xs"
    onClick={() => setHouseBetModal({ event, odds: getEventOdds(event) })}
  >
    🏦 vs. Casa
  </Button>
)}
```

- [ ] **Step 5: Add the house bet modal**

Add this modal component at the end of the JSX, alongside other modals.

`SCORE_MARGIN_OPTIONS` and `TOTAL_RUNS_OPTIONS` are module-level constants — define them above the component:

```tsx
const SCORE_MARGIN_OPTIONS = [
  { value: "home_1_5",    label: (home: string) => `${home} +1–5` },
  { value: "home_6_10",   label: (home: string) => `${home} +6–10` },
  { value: "home_11_15",  label: (home: string) => `${home} +11–15` },
  { value: "home_16plus", label: (home: string) => `${home} +16+` },
  { value: "away_1_5",    label: (_: string, away: string) => `${away} +1–5` },
  { value: "away_6_10",   label: (_: string, away: string) => `${away} +6–10` },
  { value: "away_11_15",  label: (_: string, away: string) => `${away} +11–15` },
  { value: "away_16plus", label: (_: string, away: string) => `${away} +16+` },
]

const TOTAL_RUNS_OPTIONS = [
  { value: "over_7",  label: "Más de 7",  odds: 1.40 },
  { value: "under_7", label: "Menos de 7", odds: 2.60 },
  { value: "over_8",  label: "Más de 8",  odds: 1.65 },
  { value: "under_8", label: "Menos de 8", odds: 2.02 },
  { value: "over_9",  label: "Más de 9",  odds: 2.27 },
  { value: "under_9", label: "Menos de 9", odds: 1.52 },
  { value: "over_10", label: "Más de 10", odds: 3.03 },
  { value: "under_10",label: "Menos de 10", odds: 1.30 },
]

const SCORE_MARGIN_ODDS_MAP: Record<string, number> = {
  home_1_5: 4.1, home_6_10: 4.5, home_11_15: 5.7, home_16plus: 4.1,
  away_1_5: 4.1, away_6_10: 4.5, away_11_15: 5.7, away_16plus: 4.1,
}
```

Helper to get current odds for a selection (used in "potential payout" display):

```tsx
function getSelectionOdds(
  houseBetType: string,
  houseBetSelection: string | null,
  houseBetModal: { event: Event; odds: { home: number; draw?: number; away: number } | null } | null,
  houseBetSelectionOdds: number | null
): number | null {
  if (!houseBetModal || !houseBetSelection) return null
  if (houseBetType === "direct" && houseBetModal.odds) {
    if (houseBetSelection === "home") return houseBetModal.odds.home
    if (houseBetSelection === "away") return houseBetModal.odds.away
    if (houseBetSelection === "draw") return houseBetModal.odds.draw ?? null
  }
  if (houseBetType === "score_margin") return SCORE_MARGIN_ODDS_MAP[houseBetSelection] ?? null
  if (houseBetType === "run_line") return 1.82
  if (houseBetType === "total_runs") return TOTAL_RUNS_OPTIONS.find(o => o.value === houseBetSelection)?.odds ?? null
  if (houseBetType === "exact_score") return houseBetSelectionOdds
  return null
}
```

Modal JSX:

```tsx
{houseBetModal && (() => {
  const sport = houseBetModal.event.sport
  const houseBetTypes = getHouseBetTypes(sport)
  const activeOdds = getSelectionOdds(houseBetType, houseBetSelection, houseBetModal, houseBetSelectionOdds)
  const canSubmit = !houseBetSubmitting && Number(houseBetAmount) > 0 &&
    (houseBetType === "exact_score"
      ? /^\d+[-:]\d+$/.test(houseBetExactScore) && houseBetSelectionOdds !== null
      : houseBetSelection !== null)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg">Apostar vs. Casa</h2>
          <button onClick={() => { setHouseBetModal(null); setHouseBetSelection(null); setHouseBetExactScore("") }} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <p className="text-sm text-muted-foreground">
          {houseBetModal.event.home_team} vs {houseBetModal.event.away_team}
        </p>

        {/* Bet type tabs */}
        <div className="flex gap-2 flex-wrap">
          {houseBetTypes.map(bt => (
            <Button
              key={bt.id}
              variant={houseBetType === bt.id ? "default" : "outline"}
              size="sm"
              onClick={() => { setHouseBetType(bt.id); setHouseBetSelection(null); setHouseBetExactScore("") }}
            >
              {bt.label}
            </Button>
          ))}
        </div>

        {/* Direct — 2 or 3 outcome buttons */}
        {houseBetType === "direct" && houseBetModal.odds && (
          <div className={`grid gap-2 ${houseBetModal.odds.draw !== undefined ? "grid-cols-3" : "grid-cols-2"}`}>
            {(["home", "draw", "away"] as const).filter(o => o !== "draw" || houseBetModal.odds?.draw !== undefined).map(outcome => {
              const oddsValue = outcome === "home" ? houseBetModal.odds!.home
                : outcome === "away" ? houseBetModal.odds!.away
                : houseBetModal.odds!.draw!
              const label = outcome === "home" ? houseBetModal.event.home_team
                : outcome === "away" ? houseBetModal.event.away_team
                : "Empate"
              return (
                <button key={outcome} onClick={() => setHouseBetSelection(outcome)}
                  className={`rounded-lg border p-3 text-center transition-colors ${houseBetSelection === outcome ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20" : "border-border hover:border-yellow-400"}`}>
                  <div className="text-xs text-muted-foreground truncate">{label}</div>
                  <div className="font-bold text-yellow-600">{oddsValue.toFixed(2)}x</div>
                </button>
              )
            })}
          </div>
        )}

        {/* Exact score */}
        {houseBetType === "exact_score" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Cuota: {houseBetSelectionOdds !== null ? `${houseBetSelectionOdds}x` : houseBetExactScore && /^\d+[-:]\d+$/.test(houseBetExactScore) ? "calculando..." : "ingresa un marcador"}
            </p>
            <Input placeholder="Ej: 2-1" value={houseBetExactScore} onChange={e => setHouseBetExactScore(e.target.value)} />
          </div>
        )}

        {/* Score margin — 8-button grid */}
        {houseBetType === "score_margin" && (
          <div className="grid grid-cols-2 gap-2">
            {SCORE_MARGIN_OPTIONS.map(opt => {
              const label = opt.label(houseBetModal.event.home_team, houseBetModal.event.away_team)
              const odds = SCORE_MARGIN_ODDS_MAP[opt.value]
              return (
                <button key={opt.value} onClick={() => setHouseBetSelection(opt.value)}
                  className={`rounded-lg border p-2 text-center transition-colors ${houseBetSelection === opt.value ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20" : "border-border hover:border-yellow-400"}`}>
                  <div className="text-xs truncate">{label}</div>
                  <div className="font-bold text-yellow-600 text-sm">{odds.toFixed(2)}x</div>
                </button>
              )
            })}
          </div>
        )}

        {/* Run line — 2 buttons */}
        {houseBetType === "run_line" && (
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "home_rl", label: `${houseBetModal.event.home_team} -1.5` },
              { value: "away_rl", label: `${houseBetModal.event.away_team} +1.5` },
            ].map(opt => (
              <button key={opt.value} onClick={() => setHouseBetSelection(opt.value)}
                className={`rounded-lg border p-3 text-center transition-colors ${houseBetSelection === opt.value ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20" : "border-border hover:border-yellow-400"}`}>
                <div className="text-xs text-muted-foreground">{opt.label}</div>
                <div className="font-bold text-yellow-600">1.82x</div>
              </button>
            ))}
          </div>
        )}

        {/* Total runs — 8-button grid */}
        {houseBetType === "total_runs" && (
          <div className="grid grid-cols-2 gap-2">
            {TOTAL_RUNS_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setHouseBetSelection(opt.value)}
                className={`rounded-lg border p-2 text-center transition-colors ${houseBetSelection === opt.value ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20" : "border-border hover:border-yellow-400"}`}>
                <div className="text-xs">{opt.label}</div>
                <div className="font-bold text-yellow-600 text-sm">{opt.odds.toFixed(2)}x</div>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1">
          <Label>Monto (máx. 100,000)</Label>
          <Input type="number" value={houseBetAmount} onChange={e => setHouseBetAmount(e.target.value)} placeholder="0" min={1} max={100000} />
        </div>

        {Number(houseBetAmount) > 0 && activeOdds !== null && (
          <p className="text-sm text-green-600">
            Ganancia potencial: {(Number(houseBetAmount) * activeOdds).toFixed(0)} tokens
          </p>
        )}

        <Button className="w-full" disabled={!canSubmit}
          onClick={async () => {
            setHouseBetSubmitting(true)
            try {
              const { data: { session } } = await supabase.auth.getSession()
              if (!session) { showToast("Inicia sesión para apostar", "error"); return }
              const selectionValue = houseBetType === "exact_score" ? houseBetExactScore : houseBetSelection
              const res = await fetch("/api/bets/house", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
                body: JSON.stringify({
                  userId: session.user.id,
                  eventId: houseBetModal.event.id,
                  betType: houseBetType,
                  selection: selectionValue,
                  amount: Number(houseBetAmount),
                  mode: selectedMode,  // replace with actual mode variable name from marketplace.tsx Step 1 read
                }),
              })
              const json = await res.json()
              if (!res.ok) { showToast(json.error || "Error al crear apuesta", "error"); return }
              showToast("¡Apuesta creada contra la casa!", "success")
              setHouseBetModal(null)
              setHouseBetSelection(null)
              setHouseBetExactScore("")
              setHouseBetAmount("")
            } finally {
              setHouseBetSubmitting(false)
            }
          }}
        >
          {houseBetSubmitting ? "Procesando..." : "Confirmar apuesta"}
        </Button>
      </div>
    </div>
  )
})()}
```

**Note:** `selectedMode` refers to whatever variable holds the current fantasy/real mode toggle in `marketplace.tsx`. Read the file in Step 1 to find the actual variable name and adjust accordingly.

- [ ] **Step 6: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Visual test**

Start dev server and:
- Check featured event cards show "🏦 vs. Casa" button only on events with predictions
- Open modal → odds visible for all 3 outcomes (or 2 if sport has no draw)
- Set stake of 200,001 → potential payout computes
- Submit with valid stake → success toast, modal closes
- Submit with stake > 100,000 → API returns error toast

- [ ] **Step 8: Commit**

```bash
git add components/marketplace.tsx
git commit -m "feat: house bet button and modal in marketplace for featured events"
```

---

## Spec Self-Review

**Spec coverage check:**
- ✅ 10% house edge → Task 2 (HOUSE_EDGE = 1.10)
- ✅ Max 100k tokens → Task 5 (MAX_STAKE = 100_000)
- ✅ Featured events only → Task 5 (validates `eventRow.featured`)
- ✅ Fantasy + real modes → Tasks 5, 6, 7 all branch on `betMode`
- ✅ Direct bet type → Tasks 2, 5, 9
- ✅ Exact score bet type → Tasks 2, 5, 9
- ✅ House wallet → Tasks 1, 3, 6, 8
- ✅ Auto-resolution → Task 7
- ✅ Backoffice management → Tasks 6, 8
- ✅ Payment ordering invariant respected → Task 5 (user deducted before bet insert, rollback on failure)
- ✅ No fee for house bets (edge is the revenue) → Task 5 (`fee_amount: 0`)

**Risk mitigations applied:**
- ✅ exact_score fallback removed → `calcExactScoreOdds` returns `null` when `home_goals_avg`/`away_goals_avg` absent; Task 5 rejects bet with 400 instead of pricing at unsafe 18x
- ✅ run_line restricted to MLB leagues → checked via `eventRow.league` keywords; non-MLB baseball only gets `direct`, `exact_score`, `total_runs`
- ✅ total_runs push handled → `winnerId === null` branch in Task 7 cancels bet, returns stake to user, returns reserved liability to house, notifies user
- ✅ Low balance alerts → Task 6 GET compares balances against `LOW_BALANCE_THRESHOLD = 500_000` and returns `alerts[]`; Task 8 page renders red banner when alerts present

**Type consistency:**
- `houseWalletDebit` / `houseWalletCredit` / `getHouseWalletBalances` — consistent across Tasks 3, 5, 6, 7
- `potential_payout` stored as `numeric` in DB and accessed as `Number((bet as any).potential_payout)` in Task 7
- `house_bet boolean` column: `true` written in Task 5, read in Task 7
- `DirectOutcome` type exported from `lib/house-odds.ts` and imported in Task 5

**Placeholder scan:** None found.
