# Bet Retraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow bet creators and acceptors to retract their bets with tiered penalties based on how close to the event start they cancel.

**Architecture:** A new route `POST /api/bets/[id]/retract` handles all retraction logic — validates roles and status, computes the timing window (grace / pre-game / in-game), processes wallet transactions using the existing `payoutToMode` helper with optimistic locking, records the action in `arbitration_decisions`, and notifies participants. The bet detail page adds a retract button that shows a penalty-breakdown confirmation modal before calling the route.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (PostgreSQL), `payoutToMode` from `lib/wallet-utils.ts`, `createNotifications` from `lib/notifications.ts`

---

## Penalty Rules

| Scenario | Window | Canceller loses | Other party gets |
|---|---|---|---|
| Open bet (no acceptor) | Grace (>12 h before event) | nothing | — |
| Open bet (no acceptor) | Pre-game or in-game | fee only | — |
| Taken bet (either party) | Grace (>12 h before event) | nothing | — |
| Taken bet (either party) | Pre-game (<12 h, not started) | fee + 10 % of `bet.amount` | 10 % of `bet.amount` |
| Taken bet (either party) | In-game (event live or finished) | fee + 40 % of `bet.amount` | 40 % of `bet.amount` |

**Wallet state at time of retraction:**
- Creator paid `bet.amount + bet.fee_amount` at bet creation.
- Acceptor paid `acceptorStake + acceptorFee` at bet acceptance, where:
  - `acceptorStake = bet.amount * bet.multiplier` (exact_score) or `bet.amount` (all others)
  - `acceptorFee = acceptorStake * 0.03`

**Eligible statuses:**
- Creator can retract: `open` or `taken`
- Acceptor can retract: `taken` only
- No retraction allowed once status is `pending_resolution*`, `disputed`, `resolved`, or `cancelled`

---

## File Structure

| File | Action | What changes |
|---|---|---|
| `app/api/bets/[id]/retract/route.ts` | **Create** | POST handler — all retraction business logic |
| `app/bet/[id]/page.tsx` | **Modify** | Add retract state, confirmation modal, buttons |

---

## Task 1: Retract API Route

**Files:**
- Create: `app/api/bets/[id]/retract/route.ts`

### Background

Follow the same pattern as `app/api/bets/[id]/route.ts`:
- Import from `@/lib/supabase`, `@/lib/server-auth`, `@/lib/wallet-utils`, `@/lib/notifications`
- Use `createAdminSupabaseClient()` for all DB operations
- Authenticate with `getAuthenticatedUserId(request)`
- Update bet status **before** moving money (payment ordering invariant from CLAUDE.md)
- Wrap every `payoutToMode` call in `try/catch`; on payout failure return 500 so the caller knows money didn't move

### Window helper

```ts
const GRACE_MS = 12 * 60 * 60 * 1000 // 12 hours

function retractWindow(eventStartIso: string, eventStatus: string): "grace" | "pre_game" | "in_game" {
  const eventStartMs = new Date(eventStartIso).getTime()
  const now = Date.now()
  if (eventStatus === "live" || eventStatus === "finished") return "in_game"
  if (now < eventStartMs - GRACE_MS) return "grace"
  return "pre_game"
}
```

### Refund calculation

```ts
function calcRefunds(
  bet: { amount: number; fee_amount: number; multiplier: number; bet_type: string },
  cancellerId: string,
  creatorId: string,
  window: "grace" | "pre_game" | "in_game"
): { creatorRefund: number; acceptorRefund: number } {
  const creatorStake = Number(bet.amount)
  const creatorFee = Number(bet.fee_amount)
  const isAsymmetric = bet.bet_type === "exact_score"
  const acceptorStake = isAsymmetric
    ? creatorStake * Math.max(1, Number(bet.multiplier))
    : creatorStake
  const acceptorFee = acceptorStake * 0.03

  if (window === "grace") {
    return { creatorRefund: creatorStake + creatorFee, acceptorRefund: acceptorStake + acceptorFee }
  }

  const penaltyRate = window === "in_game" ? 0.40 : 0.10
  const penalty = creatorStake * penaltyRate

  if (cancellerId === creatorId) {
    // Creator cancels: creator loses fee + penalty; acceptor receives their stake+fee back + penalty
    return {
      creatorRefund: creatorStake - penalty, // fee already lost (not in wallet)
      acceptorRefund: acceptorStake + acceptorFee + penalty,
    }
  } else {
    // Acceptor cancels: acceptor loses fee + penalty; creator receives their stake+fee back + penalty
    return {
      creatorRefund: creatorStake + creatorFee + penalty,
      acceptorRefund: acceptorStake - penalty, // fee already lost
    }
  }
}
```

> **Note on "fee already lost":** The creator's `fee_amount` was deducted from their wallet at bet creation. It is revenue for the house and is never included in `creatorRefund` except during grace period. The acceptor's fee was deducted at acceptance and is similarly excluded outside grace period.

- [ ] **Step 1: Create the file with imports, helpers, and route skeleton**

```ts
import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { payoutToMode } from "@/lib/wallet-utils"
import { createNotifications } from "@/lib/notifications"

const GRACE_MS = 12 * 60 * 60 * 1000

function retractWindow(
  eventStartIso: string,
  eventStatus: string
): "grace" | "pre_game" | "in_game" {
  const eventStartMs = new Date(eventStartIso).getTime()
  const now = Date.now()
  if (eventStatus === "live" || eventStatus === "finished") return "in_game"
  if (now < eventStartMs - GRACE_MS) return "grace"
  return "pre_game"
}

function calcRefunds(
  bet: { amount: number; fee_amount: number; multiplier: number; bet_type: string },
  cancellerId: string,
  creatorId: string,
  window: "grace" | "pre_game" | "in_game",
  betStatus: string
): { creatorRefund: number; acceptorRefund: number } {
  const creatorStake = Number(bet.amount)
  const creatorFee = Number(bet.fee_amount)
  const isAsymmetric = bet.bet_type === "exact_score"
  const acceptorStake = isAsymmetric
    ? creatorStake * Math.max(1, Number(bet.multiplier))
    : creatorStake
  const acceptorFee = acceptorStake * 0.03

  if (betStatus === "open") {
    // No acceptor — only creator can cancel
    return {
      creatorRefund: window === "grace" ? creatorStake + creatorFee : creatorStake,
      acceptorRefund: 0,
    }
  }

  // Taken bet
  if (window === "grace") {
    return {
      creatorRefund: creatorStake + creatorFee,
      acceptorRefund: acceptorStake + acceptorFee,
    }
  }

  const penaltyRate = window === "in_game" ? 0.40 : 0.10
  const penalty = creatorStake * penaltyRate

  if (cancellerId === creatorId) {
    return {
      creatorRefund: creatorStake - penalty,
      acceptorRefund: acceptorStake + acceptorFee + penalty,
    }
  } else {
    return {
      creatorRefund: creatorStake + creatorFee + penalty,
      acceptorRefund: acceptorStake - penalty,
    }
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return NextResponse.json({ ok: true }) // placeholder
}
```

- [ ] **Step 2: Verify the file compiles — run the dev server check**

Run: `npx tsc --noEmit` from `d:\Documents\Documentos\p2pBets\app`

Expected: no errors on the new file (placeholder return is fine)

- [ ] **Step 3: Implement the POST handler body — auth, bet fetch, and validation**

Replace the placeholder `POST` function with:

```ts
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()
  const { id: betId } = await context.params

  const { data: bet, error: betError } = await supabase
    .from("bets")
    .select("*, event:events(*)")
    .eq("id", betId)
    .single()

  if (betError || !bet) {
    return NextResponse.json({ error: "Bet not found" }, { status: 404 })
  }

  const isCreator = bet.creator_id === userId
  const isAcceptor = bet.acceptor_id === userId

  if (!isCreator && !isAcceptor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  // Only creator can retract open bets; both can retract taken bets
  if (bet.status === "open" && !isCreator) {
    return NextResponse.json({ error: "Solo el creador puede cancelar una apuesta abierta" }, { status: 400 })
  }

  const allowedStatuses = ["open", "taken"]
  if (!allowedStatuses.includes(bet.status)) {
    return NextResponse.json(
      { error: "No puedes retractarte en este estado de la apuesta" },
      { status: 400 }
    )
  }

  const event = Array.isArray(bet.event) ? bet.event[0] : bet.event
  if (!event?.start_time) {
    return NextResponse.json({ error: "Evento no encontrado" }, { status: 400 })
  }

  const window = retractWindow(event.start_time, event.status)
  const refunds = calcRefunds(bet, userId, bet.creator_id, window, bet.status)
  const betMode = bet.mode === "real" ? "real" : "fantasy"
  const action = isCreator ? "retract_creator" : "retract_acceptor"

  // 1. Cancel bet (payment ordering invariant: status update before any money movement)
  const { data: updatedRows, error: cancelError } = await supabase
    .from("bets")
    .update({ status: "cancelled" })
    .eq("id", betId)
    .in("status", allowedStatuses)
    .select("id")

  if (cancelError) {
    return NextResponse.json({ error: cancelError.message }, { status: 500 })
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: "La apuesta ya fue modificada por otra acción" },
      { status: 409 }
    )
  }

  // 2. Refund creator
  if (refunds.creatorRefund > 0) {
    try {
      await payoutToMode(supabase, bet.creator_id, refunds.creatorRefund, betMode)
      await supabase.from("transactions").insert({
        user_id: bet.creator_id,
        token_type: betMode === "real" ? "iBY" : "fantasy",
        amount: refunds.creatorRefund,
        operation: "bet_retracted_refund",
        reference_id: betId,
      })
    } catch (err) {
      console.error("REFUND_FAILED creator", { betId, userId: bet.creator_id, amount: refunds.creatorRefund, err })
      return NextResponse.json({ error: "Error procesando reembolso del creador" }, { status: 500 })
    }
  }

  // 3. Refund acceptor (only for taken bets)
  if (bet.status === "taken" && bet.acceptor_id && refunds.acceptorRefund > 0) {
    try {
      await payoutToMode(supabase, bet.acceptor_id, refunds.acceptorRefund, betMode)
      await supabase.from("transactions").insert({
        user_id: bet.acceptor_id,
        token_type: betMode === "real" ? "iBY" : "fantasy",
        amount: refunds.acceptorRefund,
        operation: "bet_retracted_refund",
        reference_id: betId,
      })
    } catch (err) {
      console.error("REFUND_FAILED acceptor", { betId, userId: bet.acceptor_id, amount: refunds.acceptorRefund, err })
      return NextResponse.json({ error: "Error procesando reembolso del aceptante" }, { status: 500 })
    }
  }

  // 4. Record in arbitration_decisions
  const penalty = window !== "grace" && bet.status === "taken"
    ? Number(bet.amount) * (window === "in_game" ? 0.40 : 0.10)
    : 0

  await supabase.from("arbitration_decisions").insert({
    bet_id: betId,
    action,
    previous_status: bet.status,
    new_status: "cancelled",
    decided_winner_id: null,
    reason: window === "grace"
      ? "Retracción dentro del período de gracia — sin penalidad"
      : `Retracción ${window === "in_game" ? "con partido en curso" : "pre-partido"} — penalidad ${window === "in_game" ? "40%" : "10%"}`,
    details: { window, penalty, creatorRefund: refunds.creatorRefund, acceptorRefund: refunds.acceptorRefund },
    decided_by: userId,
    source: "system",
  })

  // 5. Notify both parties
  const notifications = []
  const cancellerLabel = isCreator ? "El creador" : "El aceptante"
  const penaltyText = penalty > 0 ? ` (penalidad de ${penalty.toFixed(2)})` : ""

  notifications.push({
    userId: bet.creator_id,
    type: "bet_cancelled" as const,
    title: "Apuesta cancelada",
    body: `${cancellerLabel} se retractó de la apuesta sobre ${event.home_team} vs ${event.away_team}${penaltyText}. Reembolso: ${refunds.creatorRefund.toFixed(2)}.`,
    betId,
    mode: bet.mode ?? "fantasy",
  })

  if (bet.status === "taken" && bet.acceptor_id) {
    notifications.push({
      userId: bet.acceptor_id,
      type: "bet_cancelled" as const,
      title: "Apuesta cancelada",
      body: `${cancellerLabel} se retractó de la apuesta sobre ${event.home_team} vs ${event.away_team}${penaltyText}. Reembolso: ${refunds.acceptorRefund.toFixed(2)}.`,
      betId,
      mode: bet.mode ?? "fantasy",
    })
  }

  await createNotifications(notifications, supabase)

  return NextResponse.json({
    success: true,
    window,
    penalty,
    creatorRefund: refunds.creatorRefund,
    acceptorRefund: refunds.acceptorRefund,
  })
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit` from `d:\Documents\Documentos\p2pBets\app`

Expected: no new errors

- [ ] **Step 5: Manual smoke test — open bet grace period**

1. Start dev server: `npm run dev`
2. Create a bet on an event that starts >12h from now
3. With the creator logged in, POST to `/api/bets/{betId}/retract` with the creator's JWT
4. Expected response: `{ success: true, window: "grace", penalty: 0, creatorRefund: <amount+fee> }`
5. Verify creator wallet increased by `amount + fee`
6. Verify bet status is `cancelled` in DB

- [ ] **Step 6: Manual smoke test — taken bet pre-game**

1. Create a bet and have another user take it (event starting in <12h but not yet started)
2. Creator posts to `/api/bets/{betId}/retract`
3. Expected: `{ window: "pre_game", penalty: amount*0.10, creatorRefund: amount*0.90, acceptorRefund: acceptorStake+acceptorFee+amount*0.10 }`
4. Verify both wallets updated correctly
5. Verify `arbitration_decisions` row inserted with action `retract_creator`

- [ ] **Step 7: Commit**

```bash
git add app/api/bets/[id]/retract/route.ts
git commit -m "feat: add POST /api/bets/[id]/retract endpoint with tiered penalty logic"
```

---

## Task 2: Bet Detail Page — Retraction UI

**Files:**
- Modify: `app/bet/[id]/page.tsx`

### Where buttons appear

- **Creator, bet is `open`**: Replace/augment the "Esta es tu apuesta, Espera..." card — add a "Cancelar apuesta" button below the existing text
- **Creator, bet is `taken`**: In the creator card (status !== "open" block, taken status) — add a "Retractarse" button
- **Acceptor, bet is `taken`**: In the acceptor peer-resolution card — add a "Retractarse" button

Buttons must NOT appear when:
- Bet status is `pending_resolution*`, `disputed`, `resolved`, `cancelled`
- User is backoffice admin

### Penalty preview (client-side calculation, mirrors API logic)

```ts
function getRetractPreview(
  bet: BetDetail,
  userId: string,
  nowMs: number
): { window: "grace" | "pre_game" | "in_game"; penalty: number; myRefund: number } {
  const GRACE_MS = 12 * 60 * 60 * 1000
  const eventStartMs = new Date(bet.event.start_time).getTime()
  const eventStatus = bet.event.status ?? "scheduled"

  const window: "grace" | "pre_game" | "in_game" =
    eventStatus === "live" || eventStatus === "finished"
      ? "in_game"
      : nowMs < eventStartMs - GRACE_MS
      ? "grace"
      : "pre_game"

  const creatorStake = bet.amount
  const creatorFee = bet.fee_amount
  const isAsymmetric = bet.bet_type === "exact_score"
  const acceptorStake = isAsymmetric
    ? creatorStake * Math.max(1, bet.multiplier)
    : creatorStake
  const acceptorFee = acceptorStake * 0.03

  if (bet.status === "open") {
    return {
      window,
      penalty: 0,
      myRefund: window === "grace" ? creatorStake + creatorFee : creatorStake,
    }
  }

  if (window === "grace") {
    const myRefund = userId === bet.creator_id
      ? creatorStake + creatorFee
      : acceptorStake + acceptorFee
    return { window, penalty: 0, myRefund }
  }

  const penaltyRate = window === "in_game" ? 0.40 : 0.10
  const penalty = creatorStake * penaltyRate

  if (userId === bet.creator_id) {
    return { window, penalty, myRefund: creatorStake - penalty }
  } else {
    return { window, penalty, myRefund: acceptorStake - penalty }
  }
}
```

### State to add

```ts
const [retractLoading, setRetractLoading] = useState(false)
const [retractConfirm, setRetractConfirm] = useState(false)
```

### Handler

```ts
async function handleRetract() {
  if (!bet || !user) return
  setRetractLoading(true)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/bets/${bet.id}/retract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Error al retractarse")
    setRetractConfirm(false)
    showToast("Apuesta cancelada. Tu reembolso fue procesado.", "success")
    window.dispatchEvent(new Event("wallet:updated"))
    await loadBet()
  } catch (err: any) {
    showToast(err.message || "Error al retractarse", "error")
  } finally {
    setRetractLoading(false)
  }
}
```

### Confirmation modal

The modal shows the penalty preview. Use the same `fixed inset-0 z-50` pattern already in the file (the admin prompt dialog pattern).

```tsx
{retractConfirm && bet && user && (() => {
  const preview = getRetractPreview(bet, user.id, nowMs)
  const windowLabel = preview.window === "grace"
    ? "Período de gracia (>12h antes del evento)"
    : preview.window === "pre_game"
    ? "Pre-partido (<12h antes del evento)"
    : "Partido en curso o finalizado"
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
        <h2 className="text-lg font-semibold">¿Retractarte de la apuesta?</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ventana temporal</span>
            <span className="font-medium">{windowLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Penalidad</span>
            <span className={preview.penalty > 0 ? "font-medium text-destructive" : "font-medium text-green-500"}>
              {preview.penalty > 0 ? `-${formatCurrency(preview.penalty)}` : "Sin penalidad"}
            </span>
          </div>
          <div className="flex justify-between border-t pt-2">
            <span className="text-muted-foreground">Tu reembolso</span>
            <span className="font-bold text-green-500">{formatCurrency(preview.myRefund)}</span>
          </div>
        </div>
        {preview.penalty > 0 && (
          <p className="text-xs text-muted-foreground">
            La penalidad va al otro participante como compensación.
          </p>
        )}
        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => setRetractConfirm(false)}>
            No, quedarme
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={retractLoading}
            onClick={handleRetract}
          >
            {retractLoading ? "Procesando..." : "Confirmar retracción"}
          </Button>
        </div>
      </div>
    </div>
  )
})()}
```

- [ ] **Step 1: Add state variables after existing state declarations**

In `app/bet/[id]/page.tsx`, after the `const [adminAutoResolving, setAdminAutoResolving] = useState(false)` line (around line 85), add:

```ts
const [retractLoading, setRetractLoading] = useState(false)
const [retractConfirm, setRetractConfirm] = useState(false)
```

- [ ] **Step 2: Add `getRetractPreview` function and `handleRetract` function**

Add the `getRetractPreview` function (defined above, pure function — no hooks, place before the `return` statement of the component) and the `handleRetract` async function (inside the component, after `handleAdminAutoResolve`).

Full `getRetractPreview` (copy from "Penalty preview" section above — place just before `return (` of the component):

```ts
function getRetractPreview(
  bet: BetDetail,
  userId: string,
  nowMs: number
): { window: "grace" | "pre_game" | "in_game"; penalty: number; myRefund: number } {
  const GRACE_MS = 12 * 60 * 60 * 1000
  const eventStartMs = new Date(bet.event.start_time).getTime()
  const eventStatus = (bet.event as any).status ?? "scheduled"

  const win: "grace" | "pre_game" | "in_game" =
    eventStatus === "live" || eventStatus === "finished"
      ? "in_game"
      : nowMs < eventStartMs - GRACE_MS
      ? "grace"
      : "pre_game"

  const creatorStake = bet.amount
  const creatorFee = bet.fee_amount
  const isAsymmetric = bet.bet_type === "exact_score"
  const acceptorStake = isAsymmetric
    ? creatorStake * Math.max(1, bet.multiplier)
    : creatorStake
  const acceptorFee = acceptorStake * 0.03

  if (bet.status === "open") {
    return {
      window: win,
      penalty: 0,
      myRefund: win === "grace" ? creatorStake + creatorFee : creatorStake,
    }
  }

  if (win === "grace") {
    const myRefund =
      userId === bet.creator_id
        ? creatorStake + creatorFee
        : acceptorStake + acceptorFee
    return { window: win, penalty: 0, myRefund }
  }

  const penaltyRate = win === "in_game" ? 0.4 : 0.1
  const penalty = creatorStake * penaltyRate

  if (userId === bet.creator_id) {
    return { window: win, penalty, myRefund: creatorStake - penalty }
  }
  return { window: win, penalty, myRefund: acceptorStake - penalty }
}
```

Full `handleRetract` (inside component, after `handleAdminAutoResolve`):

```ts
async function handleRetract() {
  if (!bet || !user) return
  setRetractLoading(true)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/bets/${bet.id}/retract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Error al retractarse")
    setRetractConfirm(false)
    showToast("Apuesta cancelada. Tu reembolso fue procesado.", "success")
    window.dispatchEvent(new Event("wallet:updated"))
    await loadBet()
  } catch (err: any) {
    showToast(err.message || "Error al retractarse", "error")
  } finally {
    setRetractLoading(false)
  }
}
```

- [ ] **Step 3: Add retract button — creator open bet card**

In the block for `user && user.id === bet.creator_id && bet.status === "open"` (around line 968), add a "Cancelar apuesta" button below the existing "Ver mis apuestas" button:

```tsx
{user && user.id === bet.creator_id && bet.status === "open" && (
  <Card>
    <CardContent className="py-6 text-center">
      <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">Esta es tu apuesta</h3>
      <p className="text-muted-foreground">
        Espera a que alguien la acepte en el marketplace.
      </p>
      <div className="flex flex-col gap-2 mt-4">
        <Button asChild>
          <Link href="/my-bets">Ver mis apuestas</Link>
        </Button>
        <Button variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setRetractConfirm(true)}>
          Cancelar apuesta
        </Button>
      </div>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 4: Add retract button — creator taken bet**

In the creator's taken/non-open card (the block `user && user.id === bet.creator_id && bet.status !== "open"`, status is `taken`), add a "Retractarse" button. Locate the inner block for `taken` status (the else branch that shows peer resolution or "no peer resolution" message) and add the button at the bottom:

After the `!supportsPeerResolution && bet.status === "taken"` div, and still inside the outer `CardContent`, add:

```tsx
{bet.status === "taken" && (
  <Button
    variant="outline"
    className="w-full mt-3 text-destructive border-destructive/40 hover:bg-destructive/10"
    onClick={() => setRetractConfirm(true)}
  >
    Retractarme de esta apuesta
  </Button>
)}
```

Place this just before the closing `<Button className="mt-4" asChild>` button ("Ver mis apuestas").

- [ ] **Step 5: Add retract button — acceptor taken bet**

In the acceptor's peer-resolution card (the block `user && !isBackofficeAdmin && user.id !== bet.creator_id && (bet.status === "taken" || isPendingPeerResolution)`), add a retract button. It should only show when `bet.status === "taken"` (not in pending_resolution states) and the user is the acceptor.

At the end of `<CardContent className="pt-6 space-y-3">`, after the existing resolution buttons but before `</CardContent>`, add:

```tsx
{bet.status === "taken" && user.id === bet.acceptor_id && (
  <div className="pt-2 border-t border-border/40">
    <Button
      variant="outline"
      className="w-full text-destructive border-destructive/40 hover:bg-destructive/10"
      onClick={() => setRetractConfirm(true)}
    >
      Retractarme de esta apuesta
    </Button>
  </div>
)}
```

- [ ] **Step 6: Add the confirmation modal JSX**

Just before the existing admin `{promptDialog && ...}` modal (around line 1100), add:

```tsx
{retractConfirm && bet && user && (() => {
  const preview = getRetractPreview(bet, user.id, nowMs)
  const windowLabel =
    preview.window === "grace"
      ? "Período de gracia (>12h antes del evento)"
      : preview.window === "pre_game"
      ? "Pre-partido (<12h antes del evento)"
      : "Partido en curso o finalizado"
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
        <h2 className="text-lg font-semibold">¿Retractarte de la apuesta?</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ventana temporal</span>
            <span className="font-medium">{windowLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Penalidad</span>
            <span className={preview.penalty > 0 ? "font-medium text-destructive" : "font-medium text-green-500"}>
              {preview.penalty > 0 ? `-${formatCurrency(preview.penalty)}` : "Sin penalidad"}
            </span>
          </div>
          <div className="flex justify-between border-t pt-2">
            <span className="text-muted-foreground">Tu reembolso</span>
            <span className="font-bold text-green-500">{formatCurrency(preview.myRefund)}</span>
          </div>
        </div>
        {preview.penalty > 0 && (
          <p className="text-xs text-muted-foreground">
            La penalidad va al otro participante como compensación.
          </p>
        )}
        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => setRetractConfirm(false)}>
            No, quedarme
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={retractLoading}
            onClick={handleRetract}
          >
            {retractLoading ? "Procesando..." : "Confirmar retracción"}
          </Button>
        </div>
      </div>
    </div>
  )
})()}
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit` from `d:\Documents\Documentos\p2pBets\app`

Expected: no new errors

- [ ] **Step 8: Manual UI test — creator retracts open bet**

1. Start dev server: `npm run dev`
2. Log in as a user who has an open bet on a future event
3. Navigate to `/bet/{betId}`
4. Verify "Cancelar apuesta" button appears in the creator card
5. Click it — verify modal shows correct window ("grace" or "pre_game") and correct refund amount
6. Confirm — verify toast "Apuesta cancelada", wallet balance updates, bet status changes to `cancelled`

- [ ] **Step 9: Manual UI test — acceptor retracts taken bet**

1. Log in as a user who is the acceptor on a `taken` bet
2. Navigate to `/bet/{betId}`
3. Verify "Retractarme de esta apuesta" button appears below peer-resolution section
4. Click it — verify modal shows correct penalty and refund
5. Confirm — verify both parties' wallets updated correctly (check DB or balance page)

- [ ] **Step 10: Commit**

```bash
git add app/bet/[id]/page.tsx
git commit -m "feat: add retract button with penalty preview modal to bet detail page"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|---|---|
| Admin cancel = full refund (existing behavior) | Not changed — admin cancel already works via `/api/admin/bets` PATCH cancel |
| Creator cancels open bet — grace = full refund | Task 1 `calcRefunds` open + grace branch |
| Creator cancels open bet — no grace = lose fee | Task 1 `calcRefunds` open + no-grace branch |
| Creator OR acceptor cancels taken — grace = full refund both | Task 1 `calcRefunds` taken + grace branch |
| Creator cancels taken — pre_game = fee + 10%, 10% to acceptor | Task 1 `calcRefunds` taken + cancellerId===creatorId + pre_game |
| Creator cancels taken — in_game = fee + 40%, 40% to acceptor | Task 1 `calcRefunds` taken + cancellerId===creatorId + in_game |
| Acceptor cancels taken — pre_game = fee + 10%, 10% to creator | Task 1 `calcRefunds` taken + cancellerId!==creatorId + pre_game |
| Acceptor cancels taken — in_game = fee + 40%, 40% to creator | Task 1 `calcRefunds` taken + cancellerId!==creatorId + in_game |
| Status → cancelled definitively | Task 1 step 3 — no going back to open |
| Payment ordering invariant | Task 1 step 3 — status update first, then payouts |
| Record in arbitration_decisions | Task 1 step 3 |
| Notify both parties | Task 1 step 3 |
| UI buttons for creator (open + taken) | Task 2 steps 3 + 4 |
| UI button for acceptor (taken) | Task 2 step 5 |
| Penalty preview modal | Task 2 step 6 |
| No retraction on pending_resolution/disputed/resolved/cancelled | Task 1 step 3 `allowedStatuses` + Task 2 buttons only render on `open`/`taken` |

**No placeholders found.**

**Type consistency:** `BetDetail.event.status` exists (string type from the interface). `getRetractPreview` casts with `(bet.event as any).status` to handle the interface type — this is safe since the field is populated from the API and is always present in practice. All `payoutToMode`, `createNotifications`, `arbitration_decisions` usages match existing patterns.
