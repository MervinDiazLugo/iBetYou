# Referral System + Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a referral system with wagering-gated bonuses and a conversion-optimized landing page to drive user acquisition in the Venezuelan market.

**Architecture:** Referral codes stored on `profiles`, bonus tracking in new `referral_bonuses` table, wagering progress incremented after each bet resolution, landing page split by auth state in `app/page.tsx` with two variants (default B and referral-aware C).

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL + Auth), TypeScript, Tailwind CSS, shadcn/ui. No additional packages required — uses Node.js `crypto` for code generation.

---

## File Map

**New files:**
- `supabase/migrations/referrals.sql` — DB migration
- `lib/referrals.ts` — core helpers: applyReferral, updateWageringProgress
- `middleware.ts` — capture `?ref=` as httpOnly cookie
- `app/api/referrals/me/route.ts` — GET: user's referral code + referral list
- `app/api/referrals/preview/route.ts` — GET: public endpoint for landing (referrer nickname by code)
- `app/api/admin/referrals/route.ts` — GET: backoffice metrics
- `components/marketplace.tsx` — extracted from app/page.tsx (current marketplace content)
- `components/landing-page.tsx` — new landing with B/C variants
- `components/referral-share.tsx` — copy link + WhatsApp button
- `components/referral-bonus-banner.tsx` — progress banner for /my-bets
- `app/my-referrals/page.tsx` — referral dashboard

**Modified files:**
- `lib/notifications.ts` — add referral notification types
- `types/index.ts` — add ReferralBonus type
- `app/api/auth/callback/route.ts` — process referral cookie after auth
- `app/api/bets/[id]/resolve/route.ts` — call updateWageringProgress after resolve
- `app/api/admin/bets/auto-resolve-finished/route.ts` — same
- `app/api/admin/bets/auto-resolve-disputed/route.ts` — same
- `app/api/admin/bets/route.ts` — same (POST auto-resolve)
- `app/page.tsx` — replace content with auth-split + LandingPage/Marketplace
- `app/my-bets/page.tsx` — add ReferralBonusBanner

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/referrals.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/referrals.sql

-- Add referral columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16) UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS referral_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_referrals INTEGER NOT NULL DEFAULT 50;

-- Generate referral codes for existing users (backfill)
UPDATE profiles
SET referral_code = UPPER(SUBSTRING(MD5(id::text) FROM 1 FOR 8))
WHERE referral_code IS NULL;

-- Now make it NOT NULL after backfill
ALTER TABLE profiles ALTER COLUMN referral_code SET NOT NULL;

-- Add locked referral bonus column to wallets
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS referral_bonus_locked DECIMAL(10,2) NOT NULL DEFAULT 0;

-- New referral_bonuses table
CREATE TABLE IF NOT EXISTS referral_bonuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  beneficiary_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referrer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bonus_amount DECIMAL(10,2) NOT NULL DEFAULT 50,
  wagering_required DECIMAL(10,2) NOT NULL,
  wagering_progress DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'locked',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlocked_at TIMESTAMPTZ,
  CONSTRAINT referral_bonuses_unique UNIQUE (beneficiary_id, referee_id),
  CONSTRAINT referral_bonuses_status CHECK (status IN ('locked', 'unlocked', 'claimed')),
  CONSTRAINT referral_bonuses_parties CHECK (beneficiary_id = referrer_id OR beneficiary_id = referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_bonuses_beneficiary ON referral_bonuses(beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_referee ON referral_bonuses(referee_id);
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_status ON referral_bonuses(status);
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code);

-- RLS for referral_bonuses
ALTER TABLE referral_bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own referral bonuses" ON referral_bonuses
  FOR SELECT USING (auth.uid() = beneficiary_id);
CREATE POLICY "Service role can manage referral_bonuses" ON referral_bonuses
  FOR ALL USING (auth.role() = 'service_role');

-- Add new notification types (no CHECK constraint on notifications.type in schema,
-- but update CLAUDE.md mental model: add referral_registered, referral_bonus_unlocked)
```

- [ ] **Step 2: Run the migration in Supabase Dashboard**

Go to Supabase Dashboard → SQL Editor → paste and run `supabase/migrations/referrals.sql`.

Expected: no errors. Verify with:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name IN ('referral_code', 'referred_by', 'referral_count', 'max_referrals');
SELECT column_name FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'referral_bonus_locked';
SELECT table_name FROM information_schema.tables WHERE table_name = 'referral_bonuses';
```
Expected: 4 rows for profiles, 1 for wallets, 1 for referral_bonuses.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/referrals.sql
git commit -m "feat: add referral system DB migration"
```

---

## Task 2: Update TypeScript Types

**Files:**
- Modify: `lib/notifications.ts`
- Modify: `types/index.ts`

- [ ] **Step 1: Add referral notification types to `lib/notifications.ts`**

Replace the `NotificationType` union (lines 3-10):

```typescript
export type NotificationType =
  | "bet_created"
  | "bet_taken"
  | "result_reported"
  | "bet_resolved_win"
  | "bet_resolved_loss"
  | "bet_disputed"
  | "bet_cancelled"
  | "referral_registered"
  | "referral_bonus_unlocked"
```

- [ ] **Step 2: Add `ReferralBonus` type to `types/index.ts`**

Append to the end of `types/index.ts`:

```typescript
export interface ReferralBonus {
  id: string
  beneficiary_id: string
  referrer_id: string
  referee_id: string
  bonus_amount: number
  wagering_required: number
  wagering_progress: number
  status: 'locked' | 'unlocked' | 'claimed'
  created_at: string
  unlocked_at: string | null
}

export interface ReferralStats {
  referral_code: string
  referral_count: number
  max_referrals: number
  referrals: Array<{
    referee_id: string
    nickname: string
    created_at: string
    bonus_status: 'locked' | 'unlocked' | 'claimed'
    wagering_progress: number
    wagering_required: number
  }>
  my_bonus: ReferralBonus | null
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/notifications.ts types/index.ts
git commit -m "feat: add referral types and notification types"
```

---

## Task 3: `lib/referrals.ts` Core Helper

**Files:**
- Create: `lib/referrals.ts`

- [ ] **Step 1: Create the file**

```typescript
import { randomBytes } from "crypto"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { createNotification } from "@/lib/notifications"

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

const BONUS_AMOUNT = 50
const WAGERING_MULTIPLIER = 15
const MIN_BET_FOR_WAGERING = 10

export function generateReferralCode(): string {
  return randomBytes(4).toString("hex").toUpperCase()
}

/**
 * Called in the auth callback after a new user registers.
 * Validates the referral code, creates bonus rows, credits locked tokens.
 * Silent on invalid code — never throws.
 */
export async function applyReferral(
  newUserId: string,
  referralCode: string,
  supabase: AdminClient
): Promise<void> {
  try {
    // Find referrer by code
    const { data: referrer } = await supabase
      .from("profiles")
      .select("id, referral_count, max_referrals, referred_by, nickname")
      .eq("referral_code", referralCode)
      .single()

    if (!referrer) return

    // Anti-fraud: self-referral
    if (referrer.id === newUserId) return

    // Anti-fraud: circular referral (referrer was referred by this new user)
    if (referrer.referred_by === newUserId) return

    // Anti-fraud: max referrals reached
    const maxReferrals = referrer.max_referrals ?? 50
    if (referrer.referral_count >= maxReferrals) return

    // Anti-fraud: new user already has a referrer
    const { data: newUserProfile } = await supabase
      .from("profiles")
      .select("referred_by, nickname")
      .eq("id", newUserId)
      .single()

    if (!newUserProfile || newUserProfile.referred_by) return

    // Set referred_by atomically — if already set (race), this returns no rows
    const { data: updatedProfile, error: referredByError } = await supabase
      .from("profiles")
      .update({ referred_by: referrer.id })
      .eq("id", newUserId)
      .is("referred_by", null)
      .select("id")
      .single()

    if (referredByError || !updatedProfile) return // Race condition: already processed

    // Increment referrer's count
    await supabase
      .from("profiles")
      .update({ referral_count: referrer.referral_count + 1 })
      .eq("id", referrer.id)

    const wageringRequired = BONUS_AMOUNT * WAGERING_MULTIPLIER

    // Insert bonus rows for both parties
    await supabase.from("referral_bonuses").insert([
      {
        beneficiary_id: referrer.id,
        referrer_id: referrer.id,
        referee_id: newUserId,
        bonus_amount: BONUS_AMOUNT,
        wagering_required: wageringRequired,
        wagering_progress: 0,
        status: "locked",
      },
      {
        beneficiary_id: newUserId,
        referrer_id: referrer.id,
        referee_id: newUserId,
        bonus_amount: BONUS_AMOUNT,
        wagering_required: wageringRequired,
        wagering_progress: 0,
        status: "locked",
      },
    ])

    // Credit locked bonus to both wallets
    await supabase.rpc("increment_referral_bonus_locked", {
      p_user_id: referrer.id,
      p_amount: BONUS_AMOUNT,
    })
    await supabase.rpc("increment_referral_bonus_locked", {
      p_user_id: newUserId,
      p_amount: BONUS_AMOUNT,
    })

    // Log transactions
    await supabase.from("transactions").insert([
      {
        user_id: referrer.id,
        token_type: "fantasy",
        amount: BONUS_AMOUNT,
        operation: "referral_bonus",
        reference_id: null,
      },
      {
        user_id: newUserId,
        token_type: "fantasy",
        amount: BONUS_AMOUNT,
        operation: "referral_bonus",
        reference_id: null,
      },
    ])

    // Notify referrer
    await createNotification(
      {
        userId: referrer.id,
        type: "referral_registered",
        title: "Nuevo referido registrado",
        body: `${newUserProfile.nickname} se registró con tu código. ¡Sigue apostando para desbloquear tu bono!`,
        betId: null,
      },
      supabase
    )
  } catch (err) {
    console.error("applyReferral failed:", err)
  }
}

/**
 * Called after every bet resolution for both creator and acceptor.
 * Increments wagering progress on any locked referral bonuses.
 * Unlocks the bonus when wagering_required is met.
 */
export async function updateWageringProgress(
  userId: string,
  betAmount: number,
  supabase: AdminClient
): Promise<void> {
  if (betAmount < MIN_BET_FOR_WAGERING) return

  try {
    const { data: bonuses } = await supabase
      .from("referral_bonuses")
      .select("id, wagering_progress, wagering_required, bonus_amount")
      .eq("beneficiary_id", userId)
      .eq("status", "locked")

    if (!bonuses || bonuses.length === 0) return

    for (const bonus of bonuses) {
      const newProgress = bonus.wagering_progress + betAmount

      if (newProgress >= bonus.wagering_required) {
        // Unlock: update bonus status
        await supabase
          .from("referral_bonuses")
          .update({
            wagering_progress: newProgress,
            status: "unlocked",
            unlocked_at: new Date().toISOString(),
          })
          .eq("id", bonus.id)
          .eq("status", "locked") // optimistic lock

        // Move locked bonus to balance_fantasy
        await supabase.rpc("unlock_referral_bonus", {
          p_user_id: userId,
          p_amount: bonus.bonus_amount,
        })

        // Log transaction
        await supabase.from("transactions").insert({
          user_id: userId,
          token_type: "fantasy",
          amount: bonus.bonus_amount,
          operation: "referral_bonus_unlock",
          reference_id: bonus.id,
        })

        // Notify user
        await createNotification(
          {
            userId,
            type: "referral_bonus_unlocked",
            title: "¡Bono de referido desbloqueado!",
            body: `${bonus.bonus_amount} fichas de referido ya están disponibles en tu saldo.`,
            betId: null,
          },
          supabase
        )
      } else {
        // Just update progress
        await supabase
          .from("referral_bonuses")
          .update({ wagering_progress: newProgress })
          .eq("id", bonus.id)
          .eq("status", "locked")
      }
    }
  } catch (err) {
    console.error("updateWageringProgress failed:", err)
  }
}

/**
 * Gets or creates a referral code for a user.
 */
export async function getOrCreateReferralCode(
  userId: string,
  supabase: AdminClient
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .single()

  if (profile?.referral_code) return profile.referral_code

  const code = generateReferralCode()
  await supabase
    .from("profiles")
    .update({ referral_code: code })
    .eq("id", userId)

  return code
}
```

- [ ] **Step 2: Add DB functions for atomic wallet updates**

Run in Supabase SQL Editor (these replace the `.rpc()` calls above with direct SQL functions):

```sql
CREATE OR REPLACE FUNCTION increment_referral_bonus_locked(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE wallets SET referral_bonus_locked = referral_bonus_locked + p_amount
  WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION unlock_referral_bonus(p_user_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE wallets
  SET referral_bonus_locked = GREATEST(0, referral_bonus_locked - p_amount),
      balance_fantasy = balance_fantasy + p_amount
  WHERE user_id = p_user_id;
END;
$$;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `lib/referrals.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/referrals.ts
git commit -m "feat: add referral core helpers (applyReferral, updateWageringProgress)"
```

---

## Task 4: Middleware — Capture `?ref=` Cookie

**Files:**
- Create: `middleware.ts` (project root, next to `package.json`)

- [ ] **Step 1: Create middleware**

```typescript
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const response = NextResponse.next()
  const ref = request.nextUrl.searchParams.get("ref")

  // Only set cookie if ref param present and cookie not already set
  if (ref && ref.length >= 6 && ref.length <= 16 && !request.cookies.has("iby_ref")) {
    response.cookies.set("iby_ref", ref, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    })
  }

  return response
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|favicon.ico).*)",
}
```

- [ ] **Step 2: Verify dev server starts**

```bash
npm run dev
```

Visit `http://localhost:3000/?ref=TESTCODE`. Open DevTools → Application → Cookies.
Expected: `iby_ref` cookie set to `TESTCODE`.

Visit again without `?ref=`. Expected: `iby_ref` cookie persists (not overwritten).

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: capture referral code as httpOnly cookie via middleware"
```

---

## Task 5: Auth Callback — Process Referral on Register

**Files:**
- Modify: `app/api/auth/callback/route.ts`

- [ ] **Step 1: Add referral processing to callback**

Replace the entire file content:

```typescript
import { createAdminSupabaseClient } from "@/lib/supabase"
import { applyReferral, getOrCreateReferralCode } from "@/lib/referrals"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const response = NextResponse.redirect(new URL("/", request.url))

  if (code) {
    const supabase = createAdminSupabaseClient()

    const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

    if (!sessionError && sessionData.user) {
      const userId = sessionData.user.id

      // Check if admin — admins get no tokens and go to backoffice
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single()

      if (profile?.role === "backoffice_admin") {
        await supabase
          .from("wallets")
          .update({ balance_fantasy: 0, balance_real: 0, fantasy_total_accumulated: 0 })
          .eq("user_id", userId)
        return NextResponse.redirect(new URL("/backoffice", request.url))
      }

      // Ensure user has a referral code
      await getOrCreateReferralCode(userId, supabase)

      const today = new Date().toISOString().split("T")[0]
      const bonusPerLogin = 50
      const maxDailyBonus = 500
      const maxAccumulated = 1000

      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance_fantasy, fantasy_total_accumulated")
        .eq("user_id", userId)
        .single()

      if (wallet) {
        const currentAccumulated = wallet?.fantasy_total_accumulated || 0
        const currentBalance = wallet?.balance_fantasy || 0

        if (currentAccumulated === 0) {
          // First time: welcome bonus
          await supabase
            .from("wallets")
            .update({
              balance_fantasy: currentBalance + bonusPerLogin,
              fantasy_total_accumulated: bonusPerLogin,
            })
            .eq("user_id", userId)

          await supabase.from("transactions").insert({
            user_id: userId,
            token_type: "fantasy",
            amount: bonusPerLogin,
            operation: "welcome_bonus",
          })

          await supabase.from("daily_rewards").insert({
            user_id: userId,
            reward_amount: bonusPerLogin,
          })

          // Process referral code if present (only on first login = new registration)
          const refCode = request.cookies.get("iby_ref")?.value
          if (refCode) {
            await applyReferral(userId, refCode, supabase)
            // Clear the referral cookie
            response.cookies.delete("iby_ref")
          }
        } else {
          // Subsequent logins: daily login bonus
          const { data: todayBonuses } = await supabase
            .from("daily_rewards")
            .select("reward_amount")
            .eq("user_id", userId)
            .gte("rewarded_at", `${today}T00:00:00`)
            .lte("rewarded_at", `${today}T23:59:59`)

          const todayTotal = (todayBonuses || []).reduce(
            (sum, b) => sum + (b.reward_amount || 0),
            0
          )
          const remainingDaily = maxDailyBonus - todayTotal
          const remainingGlobal = maxAccumulated - currentAccumulated

          if (remainingDaily > 0 && remainingGlobal > 0) {
            const actualBonus = Math.min(bonusPerLogin, remainingDaily, remainingGlobal)

            await supabase
              .from("wallets")
              .update({
                balance_fantasy: currentBalance + actualBonus,
                fantasy_total_accumulated: currentAccumulated + actualBonus,
              })
              .eq("user_id", userId)

            await supabase.from("transactions").insert({
              user_id: userId,
              token_type: "fantasy",
              amount: actualBonus,
              operation: "login_bonus",
            })

            await supabase.from("daily_rewards").insert({
              user_id: userId,
              reward_amount: actualBonus,
            })
          }
        }
      }
    }
  }

  return response
}
```

- [ ] **Step 2: Manual test — new user with referral link**

1. Open incognito, visit `http://localhost:3000/?ref=<existing_user_code>`
2. Register a new account
3. After redirect, check Supabase:
```sql
SELECT referred_by, referral_count FROM profiles WHERE id = '<new_user_id>';
SELECT * FROM referral_bonuses WHERE referee_id = '<new_user_id>';
SELECT referral_bonus_locked FROM wallets WHERE user_id IN ('<new_user_id>', '<referrer_id>');
```
Expected: `referred_by` set, two referral_bonuses rows, `referral_bonus_locked = 50` for both users.

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/callback/route.ts
git commit -m "feat: process referral code in auth callback on first login"
```

---

## Task 6: Referral API Endpoints

**Files:**
- Create: `app/api/referrals/me/route.ts`
- Create: `app/api/referrals/preview/route.ts`

- [ ] **Step 1: Create `app/api/referrals/me/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { getOrCreateReferralCode } from "@/lib/referrals"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  const referralCode = await getOrCreateReferralCode(userId, supabase)
  const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || ""
  const shareUrl = `${origin}/?ref=${referralCode}`
  const whatsappText = encodeURIComponent(
    `¡Te invito a iBetYou! La plataforma donde apuestas directamente contra otros fans, sin casa de apuestas. Regístrate con mi código y recibe 50 fichas gratis: ${shareUrl}`
  )
  const whatsappUrl = `https://wa.me/?text=${whatsappText}`

  // Get referrals this user has made
  const { data: referrals } = await supabase
    .from("referral_bonuses")
    .select(`
      referee_id,
      wagering_progress,
      wagering_required,
      status,
      created_at,
      referee:profiles!referral_bonuses_referee_id_fkey(nickname)
    `)
    .eq("referrer_id", userId)
    .eq("beneficiary_id", userId) // only referrer-side bonuses = one row per referral
    .order("created_at", { ascending: false })

  // Get this user's bonus as a referee (if they were referred by someone)
  const { data: myBonus } = await supabase
    .from("referral_bonuses")
    .select("*")
    .eq("beneficiary_id", userId)
    .eq("referee_id", userId) // this user is the referee = their personal bonus
    .single()

  return NextResponse.json({
    referral_code: referralCode,
    share_url: shareUrl,
    whatsapp_url: whatsappUrl,
    referrals: (referrals || []).map((r) => ({
      referee_id: r.referee_id,
      nickname: (r.referee as any)?.nickname ?? "Usuario",
      created_at: r.created_at,
      bonus_status: r.status,
      wagering_progress: r.wagering_progress,
      wagering_required: r.wagering_required,
    })),
    my_bonus: myBonus || null,
  })
}
```

- [ ] **Step 2: Create `app/api/referrals/preview/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

// Public endpoint — no auth — used by landing page to show "X te invitó"
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 })

  const supabase = createAdminSupabaseClient()
  const { data } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("referral_code", code)
    .single()

  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 })

  return NextResponse.json({ nickname: data.nickname })
}
```

- [ ] **Step 3: Test both endpoints**

```bash
# Authenticated — replace TOKEN with your session token
curl -H "Authorization: Bearer TOKEN" http://localhost:3000/api/referrals/me

# Public — replace CODE with a real referral code
curl http://localhost:3000/api/referrals/preview?code=CODE
```

Expected: JSON with referral_code, share_url, whatsapp_url, referrals array.

- [ ] **Step 4: Commit**

```bash
git add app/api/referrals/
git commit -m "feat: add GET /api/referrals/me and /api/referrals/preview endpoints"
```

---

## Task 7: Wagering Progress Hook — All Resolve Endpoints

**Files:**
- Modify: `app/api/bets/[id]/resolve/route.ts`
- Modify: `app/api/admin/bets/auto-resolve-finished/route.ts`
- Modify: `app/api/admin/bets/auto-resolve-disputed/route.ts`
- Modify: `app/api/admin/bets/route.ts`

### 7a: `app/api/bets/[id]/resolve/route.ts`

- [ ] **Step 1: Add import**

After the existing imports (around line 6), add:

```typescript
import { updateWageringProgress } from "@/lib/referrals"
```

- [ ] **Step 2: Add wagering progress call after bet resolution**

Find the block after `const { data: resolvedBet, error: resolveError }` where the bet is confirmed resolved (around line 270 where it says `// Bet confirmed resolved — now pay winner`).

After the winner is paid and notifications are sent (at the very end of the `confirm` action, before `return NextResponse.json`), add:

```typescript
    // Update wagering progress for both parties (fire-and-forget)
    await updateWageringProgress(bet.creator_id, bet.amount, supabase)
    if (bet.acceptor_id) {
      await updateWageringProgress(bet.acceptor_id, bet.amount, supabase)
    }
```

- [ ] **Step 3: Commit this file**

```bash
git add app/api/bets/[id]/resolve/route.ts
git commit -m "feat: update referral wagering progress on peer bet resolution"
```

### 7b: `app/api/admin/bets/auto-resolve-finished/route.ts`

- [ ] **Step 1: Add import**

After the existing imports at the top of the file, add:

```typescript
import { updateWageringProgress } from "@/lib/referrals"
```

- [ ] **Step 2: Add wagering call after notifications block**

Find the `await createNotifications([...], supabase)` call inside the `for` loop (currently around line 437-440). Add the wagering call immediately after that `await`, before `resolved += 1`:

```typescript
      await createNotifications([
        { userId: winnerId, type: "bet_resolved_win", title: `¡Ganaste ${totalPrize.toFixed(2)} Fantasy Tokens!`, body: matchInfo, betId: (bet as any).id },
        { userId: loserId, type: "bet_resolved_loss", title: "Perdiste esta apuesta", body: matchInfo, betId: (bet as any).id },
      ], supabase)

      // ← ADD AFTER createNotifications:
      await updateWageringProgress((bet as any).creator_id, (bet as any).amount, supabase)
      if ((bet as any).acceptor_id) {
        await updateWageringProgress((bet as any).acceptor_id, (bet as any).amount, supabase)
      }

      resolved += 1
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/bets/auto-resolve-finished/route.ts
git commit -m "feat: update referral wagering progress in auto-resolve-finished"
```

### 7c: `app/api/admin/bets/auto-resolve-disputed/route.ts`

- [ ] **Step 1: Add import**

```typescript
import { updateWageringProgress } from "@/lib/referrals"
```

- [ ] **Step 2: Find the resolution block**

Search for `status: "resolved"` update combined with `winner_id`. In the block that follows — after `createNotifications(...)` and before the loop's `continue` or counter increment — add:

```typescript
      await updateWageringProgress(bet.creator_id, bet.amount, supabase)
      if (bet.acceptor_id) {
        await updateWageringProgress(bet.acceptor_id, bet.amount, supabase)
      }
```

The pattern to find: look for the line that calls `createNotifications` and insert the two lines immediately after.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/bets/auto-resolve-disputed/route.ts
git commit -m "feat: update referral wagering progress in auto-resolve-disputed"
```

### 7d: `app/api/admin/bets/route.ts` (POST auto-resolve)

- [ ] **Step 1: Add import**

```typescript
import { updateWageringProgress } from "@/lib/referrals"
```

- [ ] **Step 2: Find the resolution block**

Search for `createNotifications` inside the POST handler. Add immediately after the notifications call:

```typescript
      await updateWageringProgress(resolvedBet.creator_id, resolvedBet.amount, supabase)
      if (resolvedBet.acceptor_id) {
        await updateWageringProgress(resolvedBet.acceptor_id, resolvedBet.amount, supabase)
      }
```

Use the variable name that holds the resolved bet in that file (likely `resolvedBet` or `updatedBet` — match the local variable).

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/bets/route.ts
git commit -m "feat: update referral wagering progress in admin auto-resolve"
```

---

## Task 8: Landing Page — Extract Marketplace + Create Landing

**Files:**
- Create: `components/marketplace.tsx` (extracted from app/page.tsx)
- Create: `components/landing-page.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Extract marketplace into `components/marketplace.tsx`**

The current `app/page.tsx` is entirely the marketplace. Do the following:

1. Copy the entire content of `app/page.tsx`
2. Create `components/marketplace.tsx` with that content
3. Rename the default export from `default function Page()` / `export default function Home()` to `export function Marketplace()`
4. The `HomeContent` function and `Suspense` wrapper stay inside `marketplace.tsx`

The marketplace component currently wraps `HomeContent` in a `Suspense`. Keep that structure. The export should be:

```typescript
export function Marketplace() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <HomeContent />
    </Suspense>
  )
}
```

- [ ] **Step 2: Create `components/landing-page.tsx`**

```typescript
"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import Link from "next/link"

interface PreviewBet {
  id: string
  creator_selection: string
  amount: number
  event?: {
    home_team: string
    away_team: string
    sport: string
  }
  creator?: { nickname: string }
}

interface LandingPageProps {
  refCode: string | null
}

export function LandingPage({ refCode }: LandingPageProps) {
  const router = useRouter()
  const [referrerNickname, setReferrerNickname] = useState<string | null>(null)
  const [previewBets, setPreviewBets] = useState<PreviewBet[]>([])

  useEffect(() => {
    // Fetch referrer nickname for variant C
    if (refCode) {
      fetch(`/api/referrals/preview?code=${refCode}`)
        .then((r) => r.json())
        .then((d) => { if (d.nickname) setReferrerNickname(d.nickname) })
        .catch(() => {})
    }

    // Fetch preview bets for marketplace preview
    fetch("/api/bets?status=open&limit=3")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.bets)) setPreviewBets(d.bets.slice(0, 3)) })
      .catch(() => {})
  }, [refCode])

  const isReferralVariant = Boolean(refCode && referrerNickname !== undefined)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-12">
        {/* VARIANT C: Referral landing */}
        {refCode && referrerNickname !== null && (
          <div className="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-center">
            <p className="text-amber-400 font-semibold text-lg mb-1">
              {referrerNickname} te invitó a iBetYou
            </p>
            <p className="text-gray-300 text-sm mb-4">
              Regístrate ahora y recibe <span className="text-amber-400 font-bold">50 fichas gratis</span> para empezar a apostar.
            </p>
            <div className="inline-flex items-center gap-2 bg-gray-800 rounded-lg px-4 py-2 mb-4">
              <span className="text-gray-400 text-sm">Código aplicado:</span>
              <span className="text-amber-400 font-mono font-bold">{refCode}</span>
              <span className="text-green-400 text-sm">✓</span>
            </div>
            <div className="flex justify-center">
              <Link href="/login">
                <Button className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-8 py-3 text-base">
                  Reclamar mis 50 fichas →
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* VARIANT B: Default hero */}
        <div className="grid md:grid-cols-2 gap-10 items-center mb-16">
          <div>
            <h1 className="text-4xl font-bold leading-tight mb-4">
              La apuesta es entre{" "}
              <span className="text-blue-400">tú y otro fan</span>
            </h1>
            <p className="text-gray-300 text-lg mb-3">
              Sin casa de apuestas. El pozo va 100% al ganador.
            </p>
            <p className="text-gray-400 mb-8">
              Elige un partido, crea tu apuesta o toma la de otro usuario. Fútbol, béisbol y basketball.
            </p>
            <div className="flex gap-4 flex-wrap">
              <Link href="/login">
                <Button className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 text-base font-semibold">
                  Crear cuenta gratis →
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-800 px-6 py-3">
                  Iniciar sesión
                </Button>
              </Link>
            </div>

            <div className="flex gap-6 mt-8 text-sm text-gray-400">
              <div className="text-center">
                <div className="text-2xl mb-1">⚽</div>
                <div>Fútbol</div>
              </div>
              <div className="text-center">
                <div className="text-2xl mb-1">⚾</div>
                <div>Béisbol</div>
              </div>
              <div className="text-center">
                <div className="text-2xl mb-1">🏀</div>
                <div>Basketball</div>
              </div>
            </div>
          </div>

          {/* Live bets preview */}
          <div className="space-y-3">
            <p className="text-gray-400 text-sm uppercase tracking-wide font-medium mb-4">
              Apuestas activas ahora
            </p>
            {previewBets.length === 0 && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-gray-800 rounded-lg p-4 animate-pulse h-16" />
                ))}
              </div>
            )}
            {previewBets.map((bet) => (
              <div
                key={bet.id}
                className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex justify-between items-center"
              >
                <div>
                  <p className="text-white text-sm font-medium">
                    {bet.event?.home_team} vs {bet.event?.away_team}
                  </p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    {bet.creator?.nickname} apuesta: {bet.creator_selection}
                  </p>
                </div>
                <Badge className="bg-green-600 text-white text-sm font-bold">
                  {formatCurrency(bet.amount)}
                </Badge>
              </div>
            ))}
            <p className="text-center text-gray-500 text-xs pt-2">
              Regístrate gratis para ver todas las apuestas y crear las tuyas
            </p>
          </div>
        </div>

        {/* Value props */}
        <div className="grid md:grid-cols-3 gap-6 border-t border-gray-800 pt-12">
          <div className="text-center">
            <div className="text-3xl mb-3">🤝</div>
            <h3 className="font-semibold text-white mb-2">Apuestas P2P</h3>
            <p className="text-gray-400 text-sm">
              Apuestas directamente contra otro usuario. Sin intermediario, sin margen de la casa.
            </p>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-3">🏆</div>
            <h3 className="font-semibold text-white mb-2">Ganas el pozo completo</h3>
            <p className="text-gray-400 text-sm">
              El ganador se lleva el monto total apostado por ambas partes.
            </p>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-3">⚡</div>
            <h3 className="font-semibold text-white mb-2">Resolución automática</h3>
            <p className="text-gray-400 text-sm">
              Los resultados se sincronizan desde fuentes oficiales. Resolución justa y transparente.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Replace `app/page.tsx`**

Replace the entire content of `app/page.tsx`:

```typescript
"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { LandingPage } from "@/components/landing-page"
import { Marketplace } from "@/components/marketplace"
import type { Session } from "@supabase/supabase-js"

function HomeContent() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const searchParams = useSearchParams()
  const refCode = searchParams.get("ref")

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div className="min-h-screen bg-gray-950" />
  }

  if (!session) {
    return <LandingPage refCode={refCode} />
  }

  return <Marketplace />
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <HomeContent />
    </Suspense>
  )
}
```

- [ ] **Step 4: Verify in browser**

```bash
npm run dev
```

- Open `http://localhost:3000` in incognito → should see `LandingPage` (variant B)
- Open `http://localhost:3000/?ref=TESTCODE` → should see variant C with referrer banner (if code is valid) or variant B loading state
- Open `http://localhost:3000` while logged in → should see `Marketplace` (existing behavior)

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx components/marketplace.tsx components/landing-page.tsx
git commit -m "feat: split home page by auth state, add landing page variants B and C"
```

---

## Task 9: `/my-referrals` Dashboard Page

**Files:**
- Create: `components/referral-share.tsx`
- Create: `app/my-referrals/page.tsx`

- [ ] **Step 1: Create `components/referral-share.tsx`**

```typescript
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/toast"

interface ReferralShareProps {
  shareUrl: string
  whatsappUrl: string
}

export function ReferralShare({ shareUrl, whatsappUrl }: ReferralShareProps) {
  const { showToast } = useToast()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      showToast("Enlace copiado al portapapeles", "success")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast("No se pudo copiar el enlace", "error")
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-3 border border-gray-700">
        <span className="text-gray-300 text-sm flex-1 truncate">{shareUrl}</span>
        <Button
          size="sm"
          onClick={handleCopy}
          className="bg-blue-600 hover:bg-blue-500 text-white shrink-0"
        >
          {copied ? "¡Copiado!" : "Copiar"}
        </Button>
      </div>
      <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="block">
        <Button className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold">
          📲 Compartir por WhatsApp
        </Button>
      </a>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/my-referrals/page.tsx`**

```typescript
"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { Navbar } from "@/components/navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ReferralShare } from "@/components/referral-share"
import type { ReferralStats } from "@/types"

export default function MyReferralsPage() {
  const router = useRouter()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.push("/login")
        return
      }

      const res = await fetch("/api/referrals/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
      setLoading(false)
    }

    load()
  }, [router])

  const bonusStatusLabel: Record<string, string> = {
    locked: "Apostando",
    unlocked: "Desbloqueado",
    claimed: "Reclamado",
  }

  const bonusStatusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    locked: "secondary",
    unlocked: "default",
    claimed: "outline",
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-12 text-center text-gray-400">
          Cargando...
        </div>
      </div>
    )
  }

  if (!stats) return null

  const totalUnlocked = stats.referrals.filter((r) => r.bonus_status === "unlocked").length

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold">Mis Referidos</h1>

        {/* Share section */}
        <Card className="bg-gray-900 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white text-base">Comparte tu enlace</CardTitle>
          </CardHeader>
          <CardContent>
            <ReferralShare shareUrl={stats.share_url} whatsappUrl={stats.whatsapp_url} />
          </CardContent>
        </Card>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-gray-900 border-gray-700 text-center p-4">
            <div className="text-3xl font-bold text-white">{stats.referral_count}</div>
            <div className="text-gray-400 text-xs mt-1">Registrados</div>
          </Card>
          <Card className="bg-gray-900 border-gray-700 text-center p-4">
            <div className="text-3xl font-bold text-amber-400">
              {stats.referrals.filter((r) => r.bonus_status === "locked").length}
            </div>
            <div className="text-gray-400 text-xs mt-1">Bonos activos</div>
          </Card>
          <Card className="bg-gray-900 border-gray-700 text-center p-4">
            <div className="text-3xl font-bold text-green-400">{totalUnlocked * 50}</div>
            <div className="text-gray-400 text-xs mt-1">Fichas desbloqueadas</div>
          </Card>
        </div>

        {/* My own referral bonus (if I was referred) */}
        {stats.my_bonus && (
          <Card className="bg-gray-900 border-amber-500/30">
            <CardHeader>
              <CardTitle className="text-white text-base">Tu bono de registro</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-300 text-sm">50 fichas bloqueadas</span>
                <Badge variant={bonusStatusVariant[stats.my_bonus.status]}>
                  {bonusStatusLabel[stats.my_bonus.status]}
                </Badge>
              </div>
              {stats.my_bonus.status === "locked" && (
                <>
                  <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                    <div
                      className="bg-amber-500 h-2 rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (stats.my_bonus.wagering_progress / stats.my_bonus.wagering_required) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-gray-400 text-xs">
                    {stats.my_bonus.wagering_progress.toFixed(0)} /{" "}
                    {stats.my_bonus.wagering_required.toFixed(0)} fichas apostadas
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Referrals table */}
        <Card className="bg-gray-900 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white text-base">
              Referidos ({stats.referrals.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.referrals.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">
                Aún no tienes referidos. ¡Comparte tu enlace!
              </p>
            ) : (
              <div className="space-y-3">
                {stats.referrals.map((r) => (
                  <div
                    key={r.referee_id}
                    className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
                  >
                    <div>
                      <p className="text-white text-sm font-medium">{r.nickname}</p>
                      <p className="text-gray-500 text-xs">
                        {new Date(r.created_at).toLocaleDateString("es-ES", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant={bonusStatusVariant[r.bonus_status]}>
                        {bonusStatusLabel[r.bonus_status]}
                      </Badge>
                      {r.bonus_status === "locked" && (
                        <p className="text-gray-500 text-xs mt-1">
                          {r.wagering_progress.toFixed(0)}/{r.wagering_required.toFixed(0)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Test in browser**

Navigate to `http://localhost:3000/my-referrals` while logged in.
Expected: page loads with share link, WhatsApp button, stats, and referrals table.

- [ ] **Step 4: Commit**

```bash
git add components/referral-share.tsx app/my-referrals/page.tsx
git commit -m "feat: add /my-referrals dashboard with share link and referral table"
```

---

## Task 10: `ReferralBonusBanner` + Add to `/my-bets`

**Files:**
- Create: `components/referral-bonus-banner.tsx`
- Modify: `app/my-bets/page.tsx`

- [ ] **Step 1: Create `components/referral-bonus-banner.tsx`**

```typescript
"use client"

import { useState, useEffect } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import Link from "next/link"

export function ReferralBonusBanner() {
  const [lockedAmount, setLockedAmount] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ current: number; required: number } | null>(null)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch("/api/referrals/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return
      const data = await res.json()

      // Wallet locked amount
      const { data: wallet } = await supabase
        .from("wallets")
        .select("referral_bonus_locked")
        .eq("user_id", session.user.id)
        .single()

      if (wallet && wallet.referral_bonus_locked > 0) {
        setLockedAmount(wallet.referral_bonus_locked)
      }

      // Find any locked bonus to show progress
      if (data.my_bonus && data.my_bonus.status === "locked") {
        setProgress({
          current: data.my_bonus.wagering_progress,
          required: data.my_bonus.wagering_required,
        })
      }
    }

    load()
  }, [])

  if (!lockedAmount || lockedAmount <= 0) return null

  const progressPct = progress
    ? Math.min(100, (progress.current / progress.required) * 100)
    : 0
  const remaining = progress ? Math.max(0, progress.required - progress.current) : null

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="text-amber-400 font-semibold text-sm">
            {lockedAmount} fichas de referido bloqueadas
          </p>
          {remaining !== null && (
            <p className="text-gray-400 text-xs mt-0.5">
              Apuesta {remaining.toFixed(0)} fichas más para desbloquearlas
            </p>
          )}
        </div>
        <Link
          href="/my-referrals"
          className="text-amber-400 text-xs underline hover:text-amber-300"
        >
          Ver detalles
        </Link>
      </div>
      {progress && (
        <div className="w-full bg-gray-700 rounded-full h-1.5">
          <div
            className="bg-amber-500 h-1.5 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add banner to `app/my-bets/page.tsx`**

Add the import at the top of the file:

```typescript
import { ReferralBonusBanner } from "@/components/referral-bonus-banner"
```

Find where the page's main content starts (look for the `return (` with the outermost `<div>` containing `<Navbar />`). After `<Navbar />` and before the main content div, add:

```typescript
<div className="max-w-2xl mx-auto px-4 pt-4">
  <ReferralBonusBanner />
</div>
```

- [ ] **Step 3: Verify banner shows for users with locked bonuses**

Log in as a user with `referral_bonus_locked > 0`. Navigate to `/my-bets`.
Expected: amber banner with progress bar and link to `/my-referrals`.

For users without locked bonuses: banner should not render.

- [ ] **Step 4: Commit**

```bash
git add components/referral-bonus-banner.tsx app/my-bets/page.tsx
git commit -m "feat: add referral bonus progress banner to /my-bets"
```

---

## Task 11: Admin Endpoint + Navigation Link

**Files:**
- Create: `app/api/admin/referrals/route.ts`
- Modify: `app/backoffice/layout.tsx` or nav component (add Referidos link)

- [ ] **Step 1: Create `app/api/admin/referrals/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  // Total referrals created
  const { count: totalReferrals } = await supabase
    .from("referral_bonuses")
    .select("*", { count: "exact", head: true })
    .neq("beneficiary_id", null)

  // Bonuses by status
  const { data: statusCounts } = await supabase
    .from("referral_bonuses")
    .select("status")

  const locked = statusCounts?.filter((r) => r.status === "locked").length ?? 0
  const unlocked = statusCounts?.filter((r) => r.status === "unlocked").length ?? 0

  // Total locked tokens across all wallets
  const { data: walletSums } = await supabase
    .from("wallets")
    .select("referral_bonus_locked")

  const totalLocked =
    walletSums?.reduce((sum, w) => sum + (w.referral_bonus_locked || 0), 0) ?? 0

  // Top 10 referrers
  const { data: topReferrers } = await supabase
    .from("profiles")
    .select("id, nickname, referral_count")
    .gt("referral_count", 0)
    .order("referral_count", { ascending: false })
    .limit(10)

  return NextResponse.json({
    total_referral_bonuses: totalReferrals ?? 0,
    bonuses_locked: locked,
    bonuses_unlocked: unlocked,
    total_locked_tokens: totalLocked,
    top_referrers: topReferrers ?? [],
  })
}
```

- [ ] **Step 2: Add Referidos to the backoffice nav in `app/backoffice/layout.tsx`**

The `navigation` array is at lines 22-30 of `app/backoffice/layout.tsx`. Add a new import and nav item:

At the top of the file, add `Gift` to the lucide-react import:
```typescript
import {
  LayoutDashboard, Trophy, Calendar, Wallet, LogOut, Menu, X, Users, BarChart2, ClipboardList, Gift
} from "lucide-react"
```

In the `navigation` array (after `{ name: "Auditoría", ... }`), add:
```typescript
  { name: "Referidos", href: "/backoffice/referrals", icon: Gift },
```

Note: `/backoffice/referrals` page is not built in this plan (admin metrics are via the API endpoint only). If needed, create a minimal `app/backoffice/referrals/page.tsx` that calls `GET /api/admin/referrals` and displays the JSON. Otherwise, skip the nav item until the page is built.

- [ ] **Step 3: Verify endpoint**

```bash
curl -H "Authorization: Bearer ADMIN_TOKEN" http://localhost:3000/api/admin/referrals
```

Expected: JSON with `total_referral_bonuses`, `bonuses_locked`, `top_referrers`.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/referrals/route.ts app/backoffice/
git commit -m "feat: add admin referrals metrics endpoint and nav link"
```

---

## Task 12: TypeScript Build Check + Final Verification

- [ ] **Step 1: Run TypeScript compiler**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Fix any type errors before proceeding.

- [ ] **Step 2: Run ESLint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: End-to-end manual test**

Scenario A — Full referral flow:
1. Get referral code of User A from `/my-referrals`
2. Open incognito → visit `/?ref=<code>`
3. Verify cookie `iby_ref` set in DevTools
4. Register new User B
5. Check DB:
```sql
SELECT referral_code, referred_by, referral_count FROM profiles WHERE id IN ('<user_a_id>', '<user_b_id>');
SELECT * FROM referral_bonuses;
SELECT referral_bonus_locked FROM wallets WHERE user_id IN ('<user_a_id>', '<user_b_id>');
```
Expected: User B's `referred_by = user_a_id`, two bonus rows, 50 locked for each.

Scenario B — Wagering progress:
1. As User B, create and resolve a bet with `amount >= 10`
2. Check:
```sql
SELECT wagering_progress, status FROM referral_bonuses WHERE beneficiary_id = '<user_b_id>';
```
Expected: `wagering_progress` increased.

Scenario C — Landing page:
1. Log out → visit `/` → see LandingPage variant B
2. Visit `/?ref=VALIDCODE` → see variant C with referrer name
3. Log in → visit `/` → see Marketplace

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: referral system + landing page complete"
```
