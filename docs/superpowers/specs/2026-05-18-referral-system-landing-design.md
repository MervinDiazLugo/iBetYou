# Referral System + Landing Page — Design Spec
**Date:** 2026-05-18  
**Project:** iBetYou P2P Betting Platform  
**Scope:** Acquisition features for Venezuelan market

---

## 1. Overview

Two related features to support user acquisition:

1. **Referral System** — existing users share a unique link; both referrer and referee receive locked fantasy token bonuses that unlock after completing a wagering requirement.
2. **Landing Page** — unauthenticated visitors see a marketing landing instead of the marketplace. Two variants: default (B) and referral-aware (C).

---

## 2. Data Model

### `profiles` table — new columns
```sql
referral_code     text UNIQUE NOT NULL  -- 8-char nanoid, generated on user creation
referred_by       uuid REFERENCES profiles(id) NULL
referral_count    int NOT NULL DEFAULT 0
max_referrals     int NOT NULL DEFAULT 50
```

**Constraints:**
- `referred_by` cannot equal own `id` (self-referral blocked)
- If A's `referred_by = B`, then B's `referred_by` cannot be set to A (circular blocked)
- `referral_code` generated server-side with `nanoid(8)`, never user-supplied

### New table: `referral_bonuses`
```sql
id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
referrer_id       uuid NOT NULL REFERENCES profiles(id)
referee_id        uuid NOT NULL REFERENCES profiles(id)
bonus_amount      numeric NOT NULL DEFAULT 50
wagering_required numeric NOT NULL  -- bonus_amount × 15
wagering_progress numeric NOT NULL DEFAULT 0
status            text NOT NULL DEFAULT 'locked'  -- 'locked' | 'unlocked' | 'claimed'
created_at        timestamptz NOT NULL DEFAULT now()
unlocked_at       timestamptz NULL

CONSTRAINT referral_bonuses_unique UNIQUE (referrer_id, referee_id)
CONSTRAINT referral_bonuses_status CHECK (status IN ('locked', 'unlocked', 'claimed'))
CONSTRAINT referral_bonuses_progress CHECK (wagering_progress >= 0)
```

### `wallets` table — new column
```sql
referral_bonus_locked  numeric NOT NULL DEFAULT 0
```

### `transactions` table — new operation values
- `'referral_bonus'` — when bonus is credited (locked)
- `'referral_bonus_unlock'` — when wagering requirement is met and bonus moves to `balance_fantasy`

---

## 3. Business Rules

### Bonus amounts
- **Referrer:** 50 fantasy tokens (locked)
- **Referee:** 50 fantasy tokens (locked) — in addition to existing $50 welcome bonus
- **Wagering requirement:** 15× bonus = 750 fichas in resolved bets before unlock
- **Minimum bet for wagering progress:** amount >= 10 fichas (prevents micro-bet farming)

### Anti-fraud
| Rule | Enforcement |
|---|---|
| No self-referral | API: block if `referral_code` belongs to registering user |
| No circular referrals | API: block if referrer's `referred_by = new_user.id` |
| Max referrals per user | API: block if `referral_count >= max_referrals` (default 50) |
| One bonus per user pair | DB: UNIQUE constraint on `(referrer_id, referee_id)` |
| Wagering on resolved bets only | Progress counted only when `bets.status = 'resolved'` |
| Rate limiting on registration | Middleware: max 10 registrations per IP per hour |

### Referral code persistence
- `?ref=CODE` captured in a 30-day cookie (`iby_ref`) before user reaches auth flow
- If user closes tab and returns, the code is still applied at registration
- Cookie is cleared after successful referral registration

### Silent failure on limit reached
- If referrer has hit `max_referrals`, the new user registers normally (no bonus for either party)
- No error shown to the new user — seamless experience
- No notification to referrer (prevents them from asking friends to create fake accounts)

---

## 4. API Endpoints

### New endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/referrals/me` | User | Idempotent: returns existing referral code (generates one if missing), share URL, WhatsApp message, list of referrals with status |

### Modified endpoints

| Method | Path | Change |
|---|---|---|
| `GET` | `/api/auth/callback/route.ts` (Supabase auth callback) | After successful auth, reads `iby_ref` cookie; validates code; creates `referral_bonuses` rows; credits locked bonus atomically; clears cookie |
| `PATCH` | `/api/bets/[id]/resolve` | After resolving, calls `updateWageringProgress(userId, amount)` for both creator and acceptor |
| `POST` | `/api/admin/bets` (auto-resolve) | Same — calls `updateWageringProgress` for both parties |
| `POST` | `/api/admin/bets/auto-resolve-finished` | Same |
| `POST` | `/api/admin/bets/auto-resolve-disputed` | Same |

### Internal helper: `lib/referrals.ts`
```ts
updateWageringProgress(userId: string, betAmount: number, supabase): Promise<void>
// Called after every bet resolution. Finds locked referral_bonuses for userId,
// adds betAmount to wagering_progress. If progress >= wagering_required:
//   - Sets status = 'unlocked'
//   - Moves bonus_amount from wallets.referral_bonus_locked to balance_fantasy
//   - Inserts transaction 'referral_bonus_unlock'
//   - Sends notification 'bet_resolved_win' type with unlock message
```

### Admin endpoint

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/referrals` | Backoffice | Global metrics: total referrals, total bonuses locked/unlocked, top referrers |

---

## 5. UI Components

### New pages

| Path | Description |
|---|---|
| `app/my-referrals/page.tsx` | Dashboard: share link, WhatsApp button, referral table with status |

### New components

| Component | Location | Description |
|---|---|---|
| `ReferralShare` | `components/referral-share.tsx` | Copy link button + WhatsApp share button |
| `ReferralBonusBanner` | `components/referral-bonus-banner.tsx` | Progress banner shown in `/my-bets`: "X fichas bloqueadas — apuesta Y más para desbloquearlas" |

### Modified pages

| Page | Change |
|---|---|
| `app/page.tsx` | Split by session: no session → `<LandingPage>`, session exists → `<Marketplace>` (existing content) |

### Landing page variants

**Variant B (default — no `?ref=` param):**
- Navbar with login/register CTAs
- Hero: "La apuesta es entre tú y otro fan" — value prop P2P (no house edge)
- Live marketplace preview: shows 2-3 real active bets (fetched from DB, no auth required)
- 3 sport icons with bet counts
- CTA: "Crear cuenta gratis →"

**Variant C (`?ref=CODE` present):**
- Same navbar
- Hero replaced with: referral banner — "NICKNAME te invitó" + "50 fichas te esperan"
- Referral code shown as applied ✓
- CTA: "Reclamar mis 50 fichas →" (amber button, higher contrast)
- Below fold: same marketplace preview as Variant B

**Language:** Español neutro (tú/tu). No argentinismos (no "vos", no "che").

### `/my-referrals` dashboard content
- Referral link with one-click copy
- WhatsApp button: opens `https://wa.me/?text=` with pre-written Spanish neutral message
- Stats row: Referidos registrados / Bonos activos / Fichas desbloqueadas
- Table: nickname | fecha registro | estado (Apostando / Desbloqueado) | bonus

### Notifications (uses existing `lib/notifications.ts`)
Two new notification types must be added to the `notifications.type` column:
- `referral_registered`: "¡Tu referido {nickname} se registró!" — sent to referrer on registration
- `referral_bonus_unlocked`: "¡Desbloqueaste 50 fichas de referido!" — sent to user when wagering met

---

## 6. Security Checklist

- [x] `referral_code` generated server-side (nanoid), never client-supplied
- [x] Bonus credited in atomic DB transaction (rollback if any step fails)
- [x] UNIQUE constraint prevents duplicate bonus rows (race condition safe)
- [x] Self-referral blocked at API level
- [x] Circular referral blocked at API level
- [x] Max referrals enforced before crediting
- [x] Wagering progress only on resolved bets with amount >= 10
- [x] Registration rate limiting by IP
- [x] Cookie for ref code is httpOnly, sameSite=lax
- [x] Admin can revoke bonuses (PATCH on referral_bonuses.status)

---

## 7. Edge Cases

- **Banned user with locked bonus:** If a user is banned (`profiles.is_banned = true`), their `referral_bonus_locked` stays frozen. Admin can zero it out manually via wallet management. No automatic forfeiture logic needed at this stage.
- **Referral code applied to already-registered user:** Auth callback checks if `profiles.referred_by` is already set → silently skips bonus creation, clears cookie.
- **Referrer deleted/banned after referral:** `referral_bonuses` row stays intact. The referrer's bonus remains in DB but is effectively unreachable if account is banned.

---

## 8. Out of Scope

- Phone number verification (requires external SMS service — separate initiative)
- Conversion tracking / analytics events (can be added in a later sprint)
- Multi-tier referrals (A refers B refers C — A gets cut) — intentionally excluded (increases fraud surface)
- Referral leaderboard / gamification — future feature

---

## 8. Implementation Order

1. DB migration (new columns + `referral_bonuses` table)
2. `lib/referrals.ts` helper
3. Auth flow: capture `?ref=` cookie + apply at registration
4. `GET/POST /api/referrals/me` + `generate`
5. Wagering progress hook in all resolve endpoints
6. `app/page.tsx` split + landing variants B and C
7. `app/my-referrals/page.tsx` + components
8. `ReferralBonusBanner` in `/my-bets`
9. Admin endpoint + backoffice metrics
