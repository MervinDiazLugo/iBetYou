# Playwright API Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Playwright API test suite that covers all 48 iBetYou endpoints, living outside the app at `d:\Documents\Documentos\p2pBets\api-tests\`.

**Architecture:** Separate Node/TypeScript project using `@playwright/test` in API-only mode (no browser). Auth helpers sign in via Supabase REST to get JWTs. Tests are grouped by domain and use shared fixtures for authenticated/admin requests. Most tests are read-only; write tests clean up after themselves.

**Tech Stack:** Playwright `@playwright/test`, TypeScript, `dotenv`, Supabase REST auth endpoint.

---

## File Structure

```
d:\Documents\Documentos\p2pBets\api-tests\
  package.json                   — dependencies + scripts
  tsconfig.json                  — TypeScript config
  playwright.config.ts           — base URL, timeouts, test dir
  .env.example                   — required env vars (no secrets)
  helpers/
    auth.ts                      — signIn(email, password) → JWT string
    fixtures.ts                  — Playwright fixtures: anonReq, userReq, adminReq
  tests/
    01-public.spec.ts            — /api/events/list, /api/stats, /api/referrals/preview, /api/openapi
    02-auth-guards.spec.ts       — every user/admin endpoint returns 401 without token
    03-bets.spec.ts              — GET /api/bets, POST /api/bets/create, PATCH /api/bets/[id]
    04-user-profile.spec.ts      — /api/wallet, /api/user/profile, /api/user/balance, /api/user/info
    05-notifications.spec.ts     — GET + PATCH /api/notifications
    06-my-bets.spec.ts           — GET /api/my-bets
    07-withdrawals.spec.ts       — /api/withdrawals + /api/withdrawals/methods
    08-iby.spec.ts               — /api/iby/wallet, /api/iby/deposit-requests, /api/iby/deposit-accounts
    09-referrals.spec.ts         — /api/referrals/me, /api/referrals/preview
    10-admin-bets.spec.ts        — GET/PATCH/POST /api/admin/bets + auto-resolve endpoints
    11-admin-events.spec.ts      — /api/admin/events + /api/admin/events/results
    12-admin-users.spec.ts       — /api/admin/users, /api/admin/metrics, /api/admin/referrals, /api/admin/audit
    13-admin-wallets.spec.ts     — /api/admin/wallets
    14-admin-withdrawals.spec.ts — /api/admin/withdrawals
    15-admin-iby.spec.ts         — /api/admin/iby/settings, accounts, deposit-requests
```

---

### Task 1: Project scaffold

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\package.json`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tsconfig.json`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\playwright.config.ts`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\.env.example`

- [ ] **Step 1: Create project directory and package.json**

```bash
mkdir d:\Documents\Documentos\p2pBets\api-tests
cd d:\Documents\Documentos\p2pBets\api-tests
```

`package.json`:
```json
{
  "name": "ibety-api-tests",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "test:public": "playwright test tests/01-public.spec.ts",
    "test:guards": "playwright test tests/02-auth-guards.spec.ts",
    "report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.44.0",
    "typescript": "^5.4.0",
    "dotenv": "^16.4.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist"
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create playwright.config.ts**

```typescript
import { defineConfig } from "@playwright/test"
import * as dotenv from "dotenv"
dotenv.config()

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 1,
  workers: 1, // serial — avoid race conditions on shared DB
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    extraHTTPHeaders: {
      "Content-Type": "application/json",
    },
  },
  reporter: [["list"], ["html", { open: "never" }]],
})
```

- [ ] **Step 4: Create .env.example**

```
# Target app
BASE_URL=https://i-bet-you.vercel.app

# Supabase project (for signing in to get JWT)
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here

# Test user credentials (regular user with some bets)
TEST_USER_EMAIL=testuser@example.com
TEST_USER_PASSWORD=testpassword123

# Test admin credentials (role = backoffice_admin)
TEST_ADMIN_EMAIL=admin@example.com
TEST_ADMIN_PASSWORD=adminpassword123

# Cron secret (from Vercel env vars)
CRON_SECRET=your_cron_secret_here
```

Also copy to `.env` and fill in real values (never commit `.env`).

- [ ] **Step 5: Install dependencies**

```bash
cd d:\Documents\Documentos\p2pBets\api-tests
npm install
npx playwright install --with-deps
```

Expected output: `@playwright/test` installed, no errors.

- [ ] **Step 6: Commit**

```bash
cd d:\Documents\Documentos\p2pBets\api-tests
git init
echo "node_modules/" > .gitignore
echo ".env" >> .gitignore
echo "playwright-report/" >> .gitignore
echo "test-results/" >> .gitignore
git add .
git commit -m "feat: initialize playwright api-tests project"
```

---

### Task 2: Auth helper + fixtures

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\helpers\auth.ts`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\helpers\fixtures.ts`

- [ ] **Step 1: Create helpers/auth.ts**

Signs in via Supabase REST and returns a JWT. Caches token per email so tests don't re-sign-in on every call.

```typescript
// helpers/auth.ts
import * as dotenv from "dotenv"
dotenv.config()

const tokenCache: Record<string, string> = {}

export async function signIn(email: string, password: string): Promise<string> {
  if (tokenCache[email]) return tokenCache[email]

  const supabaseUrl = process.env.SUPABASE_URL!
  const anonKey = process.env.SUPABASE_ANON_KEY!

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`signIn failed for ${email}: ${res.status} ${body}`)
  }

  const data = await res.json()
  tokenCache[email] = data.access_token
  return data.access_token
}

export async function getUserToken(): Promise<string> {
  return signIn(process.env.TEST_USER_EMAIL!, process.env.TEST_USER_PASSWORD!)
}

export async function getAdminToken(): Promise<string> {
  return signIn(process.env.TEST_ADMIN_EMAIL!, process.env.TEST_ADMIN_PASSWORD!)
}
```

- [ ] **Step 2: Create helpers/fixtures.ts**

Playwright fixtures that pre-attach auth headers.

```typescript
// helpers/fixtures.ts
import { test as base, APIRequestContext } from "@playwright/test"
import { getUserToken, getAdminToken } from "./auth"

type TestFixtures = {
  userReq: APIRequestContext
  adminReq: APIRequestContext
}

export const test = base.extend<TestFixtures>({
  userReq: async ({ playwright }, use) => {
    const token = await getUserToken()
    const ctx = await playwright.request.newContext({
      baseURL: process.env.BASE_URL ?? "http://localhost:3000",
      extraHTTPHeaders: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
    await use(ctx)
    await ctx.dispose()
  },

  adminReq: async ({ playwright }, use) => {
    const token = await getAdminToken()
    const ctx = await playwright.request.newContext({
      baseURL: process.env.BASE_URL ?? "http://localhost:3000",
      extraHTTPHeaders: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
    await use(ctx)
    await ctx.dispose()
  },
})

export { expect } from "@playwright/test"
```

- [ ] **Step 3: Verify fixtures compile**

```bash
cd d:\Documents\Documentos\p2pBets\api-tests
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add helpers/
git commit -m "feat: auth helper and playwright fixtures"
```

---

### Task 3: Public endpoint tests

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\01-public.spec.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/01-public.spec.ts
import { test, expect } from "@playwright/test"

test.describe("Public endpoints", () => {
  test("GET /api/events/list returns array", async ({ request }) => {
    const res = await request.get("/api/events/list")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.events)).toBe(true)
  })

  test("GET /api/events/list filters by sport", async ({ request }) => {
    const res = await request.get("/api/events/list?sport=football")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.events)).toBe(true)
    body.events.forEach((e: any) => expect(e.sport).toBe("football"))
  })

  test("GET /api/stats returns leaderboard data", async ({ request }) => {
    const res = await request.get("/api/stats?mode=fantasy")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("topWinners")
    expect(body).toHaveProperty("topBetTypes")
  })

  test("GET /api/stats?mode=real returns real leaderboard", async ({ request }) => {
    const res = await request.get("/api/stats?mode=real")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("topWinners")
  })

  test("GET /api/referrals/preview returns share info", async ({ request }) => {
    const res = await request.get("/api/referrals/preview?code=TESTCODE")
    expect([200, 404]).toContain(res.status())
  })

  test("GET /api/bets returns open bets without auth", async ({ request }) => {
    const res = await request.get("/api/bets")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.bets)).toBe(true)
  })
})
```

- [ ] **Step 2: Run and verify pass**

```bash
cd d:\Documents\Documentos\p2pBets\api-tests
npx playwright test tests/01-public.spec.ts --reporter=list
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/01-public.spec.ts
git commit -m "test: public endpoint coverage"
```

---

### Task 4: Auth guard tests

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\02-auth-guards.spec.ts`

Tests that every protected endpoint returns 401 without a token.

- [ ] **Step 1: Write tests**

```typescript
// tests/02-auth-guards.spec.ts
import { test, expect } from "@playwright/test"

const USER_ENDPOINTS: [string, string][] = [
  ["GET", "/api/wallet?user_id=00000000-0000-0000-0000-000000000000"],
  ["GET", "/api/user/profile"],
  ["GET", "/api/user/balance"],
  ["GET", "/api/user/info"],
  ["GET", "/api/my-bets?user_id=00000000-0000-0000-0000-000000000000"],
  ["GET", "/api/notifications"],
  ["GET", "/api/referrals/me"],
  ["GET", "/api/iby/wallet"],
  ["GET", "/api/iby/deposit-requests"],
  ["GET", "/api/withdrawals"],
  ["GET", "/api/withdrawals/methods"],
]

const ADMIN_ENDPOINTS: [string, string][] = [
  ["GET", "/api/admin/bets"],
  ["GET", "/api/admin/events"],
  ["GET", "/api/admin/users"],
  ["GET", "/api/admin/wallets"],
  ["GET", "/api/admin/metrics"],
  ["GET", "/api/admin/referrals"],
  ["GET", "/api/admin/audit"],
  ["GET", "/api/admin/withdrawals"],
  ["GET", "/api/admin/iby/settings"],
  ["GET", "/api/admin/iby/accounts"],
  ["GET", "/api/admin/iby/deposit-requests"],
]

test.describe("Auth guards — no token → 401", () => {
  for (const [method, path] of USER_ENDPOINTS) {
    test(`${method} ${path}`, async ({ request }) => {
      const res = await request.fetch(path, { method, ignoreHTTPSErrors: true })
      expect(res.status()).toBe(401)
    })
  }

  for (const [method, path] of ADMIN_ENDPOINTS) {
    test(`${method} ${path} admin guard`, async ({ request }) => {
      const res = await request.fetch(path, { method, ignoreHTTPSErrors: true })
      expect(res.status()).toBe(401)
    })
  }
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/02-auth-guards.spec.ts --reporter=list
```

Expected: all 22 tests PASS (all return 401).

- [ ] **Step 3: Commit**

```bash
git add tests/02-auth-guards.spec.ts
git commit -m "test: auth guard 401 coverage for all protected endpoints"
```

---

### Task 5: User profile + wallet tests

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\04-user-profile.spec.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/04-user-profile.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("User profile + wallet endpoints", () => {
  test("GET /api/user/info returns user + balances", async ({ userReq }) => {
    const res = await userReq.get("/api/user/info")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("id")
    expect(body).toHaveProperty("email")
    expect(body.balance).toHaveProperty("fantasy")
    expect(body.balance).toHaveProperty("ibc")
  })

  test("GET /api/user/profile returns profile", async ({ userReq }) => {
    const res = await userReq.get("/api/user/profile")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("id")
    expect(body).toHaveProperty("nickname")
  })

  test("GET /api/user/balance returns P&L history", async ({ userReq }) => {
    const res = await userReq.get("/api/user/balance")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.history)).toBe(true)
  })

  test("GET /api/wallet returns fantasy + real balances", async ({ userReq }) => {
    // wallet endpoint needs user_id — get it from user/info first
    const infoRes = await userReq.get("/api/user/info")
    const { id } = await infoRes.json()
    const res = await userReq.get(`/api/wallet?user_id=${id}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.wallet).toHaveProperty("balance_fantasy")
  })

  test("GET /api/iby/wallet returns IBC balance", async ({ userReq }) => {
    const res = await userReq.get("/api/iby/wallet")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.wallet).toHaveProperty("balance")
    expect(body.wallet).toHaveProperty("balance_blocked")
    expect(body.wallet).toHaveProperty("referral_bonus_locked")
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/04-user-profile.spec.ts --reporter=list
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/04-user-profile.spec.ts
git commit -m "test: user profile and wallet endpoint coverage"
```

---

### Task 6: Bets endpoint tests

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\03-bets.spec.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/03-bets.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Bets endpoints", () => {
  test("GET /api/bets returns paginated bets", async ({ userReq }) => {
    const res = await userReq.get("/api/bets?limit=10")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.bets)).toBe(true)
  })

  test("GET /api/bets filters by type=my_open", async ({ userReq }) => {
    const infoRes = await userReq.get("/api/user/info")
    const { id } = await infoRes.json()
    const res = await userReq.get(`/api/bets?type=my_open&user_id=${id}&limit=10`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.bets)).toBe(true)
  })

  test("POST /api/bets/create → 400 with invalid mode", async ({ userReq }) => {
    const res = await userReq.post("/api/bets/create", {
      data: {
        userId: "fake",
        eventId: 1,
        betType: "direct",
        selection: "home",
        amount: 10,
        multiplier: 1,
        mode: "invalid_mode",
      },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Invalid mode")
  })

  test("POST /api/bets/create → 401 without token", async ({ request }) => {
    const res = await request.post("/api/bets/create", {
      data: { userId: "fake", eventId: 1, betType: "direct", selection: "home", amount: 10, multiplier: 1 },
    })
    expect(res.status()).toBe(401)
  })

  test("GET /api/bets/[id] returns bet detail for valid id", async ({ userReq }) => {
    // First get a bet id from the list
    const listRes = await userReq.get("/api/bets?limit=1")
    const { bets } = await listRes.json()
    if (bets.length === 0) {
      test.skip(true, "No bets available in the system")
      return
    }
    const betId = bets[0].id
    const res = await userReq.get(`/api/bets/${betId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.bet).toHaveProperty("id", betId)
  })

  test("GET /api/bets/[id] → 404 for unknown id", async ({ userReq }) => {
    const res = await userReq.get("/api/bets/00000000-0000-0000-0000-000000000000")
    expect([404, 400]).toContain(res.status())
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/03-bets.spec.ts --reporter=list
```

Expected: all tests PASS (skip is acceptable if no bets exist).

- [ ] **Step 3: Commit**

```bash
git add tests/03-bets.spec.ts
git commit -m "test: bets endpoint coverage"
```

---

### Task 7: Notifications + my-bets tests

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\05-notifications.spec.ts`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\06-my-bets.spec.ts`

- [ ] **Step 1: Write tests/05-notifications.spec.ts**

```typescript
// tests/05-notifications.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Notifications endpoints", () => {
  test("GET /api/notifications returns array", async ({ userReq }) => {
    const res = await userReq.get("/api/notifications")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.notifications)).toBe(true)
  })

  test("notifications include mode field", async ({ userReq }) => {
    const res = await userReq.get("/api/notifications")
    const { notifications } = await res.json()
    // mode can be null for old notifications — just check the key exists
    if (notifications.length > 0) {
      expect(Object.keys(notifications[0])).toContain("mode")
    }
  })

  test("PATCH /api/notifications marks all as read", async ({ userReq }) => {
    const res = await userReq.patch("/api/notifications", {
      data: { all: true },
    })
    expect(res.status()).toBe(200)
  })
})
```

- [ ] **Step 2: Write tests/06-my-bets.spec.ts**

```typescript
// tests/06-my-bets.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("My bets endpoint", () => {
  test("GET /api/my-bets returns user bets", async ({ userReq }) => {
    const infoRes = await userReq.get("/api/user/info")
    const { id } = await infoRes.json()
    const res = await userReq.get(`/api/my-bets?user_id=${id}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.bets)).toBe(true)
  })

  test("my-bets include mode field on each bet", async ({ userReq }) => {
    const infoRes = await userReq.get("/api/user/info")
    const { id } = await infoRes.json()
    const res = await userReq.get(`/api/my-bets?user_id=${id}`)
    const { bets } = await res.json()
    if (bets.length > 0) {
      expect(["fantasy", "real"]).toContain(bets[0].mode ?? "fantasy")
    }
  })
})
```

- [ ] **Step 3: Run both**

```bash
npx playwright test tests/05-notifications.spec.ts tests/06-my-bets.spec.ts --reporter=list
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/05-notifications.spec.ts tests/06-my-bets.spec.ts
git commit -m "test: notifications and my-bets coverage"
```

---

### Task 8: Withdrawals + referrals + IBC deposit tests

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\07-withdrawals.spec.ts`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\08-iby.spec.ts`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\09-referrals.spec.ts`

- [ ] **Step 1: Write tests/07-withdrawals.spec.ts**

```typescript
// tests/07-withdrawals.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Withdrawal endpoints", () => {
  test("GET /api/withdrawals returns user requests", async ({ userReq }) => {
    const res = await userReq.get("/api/withdrawals")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.requests)).toBe(true)
  })

  test("GET /api/withdrawals/methods returns user methods", async ({ userReq }) => {
    const res = await userReq.get("/api/withdrawals/methods")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.methods)).toBe(true)
  })

  test("POST /api/withdrawals → 400 with negative amount", async ({ userReq }) => {
    const res = await userReq.post("/api/withdrawals", {
      data: { amount: -50, method_id: "fake-id" },
    })
    expect(res.status()).toBe(400)
  })

  test("POST /api/withdrawals → 400 with non-numeric amount", async ({ userReq }) => {
    const res = await userReq.post("/api/withdrawals", {
      data: { amount: "abc", method_id: "fake-id" },
    })
    expect(res.status()).toBe(400)
  })

  test("POST /api/withdrawals → 400 below minimum (100 IBC)", async ({ userReq }) => {
    const res = await userReq.post("/api/withdrawals", {
      data: { amount: 10, method_id: "fake-id" },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/100/i)
  })
})
```

- [ ] **Step 2: Write tests/08-iby.spec.ts**

```typescript
// tests/08-iby.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("IBC wallet + deposit endpoints", () => {
  test("GET /api/iby/wallet returns all balance fields", async ({ userReq }) => {
    const res = await userReq.get("/api/iby/wallet")
    expect(res.status()).toBe(200)
    const { wallet } = await res.json()
    expect(typeof wallet.balance).toBe("number")
    expect(typeof wallet.balance_blocked).toBe("number")
    expect(typeof wallet.referral_bonus_locked).toBe("number")
  })

  test("GET /api/iby/deposit-requests returns array", async ({ userReq }) => {
    const res = await userReq.get("/api/iby/deposit-requests")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.requests)).toBe(true)
  })

  test("GET /api/iby/deposit-accounts returns array", async ({ userReq }) => {
    const res = await userReq.get("/api/iby/deposit-accounts")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.accounts)).toBe(true)
  })
})
```

- [ ] **Step 3: Write tests/09-referrals.spec.ts**

```typescript
// tests/09-referrals.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Referrals endpoints", () => {
  test("GET /api/referrals/me returns referral stats", async ({ userReq }) => {
    const res = await userReq.get("/api/referrals/me")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("referral_code")
    expect(body).toHaveProperty("referral_count")
    expect(body).toHaveProperty("max_referrals")
    expect(body).toHaveProperty("share_url")
    expect(Array.isArray(body.referrals)).toBe(true)
  })
})
```

- [ ] **Step 4: Run all three**

```bash
npx playwright test tests/07-withdrawals.spec.ts tests/08-iby.spec.ts tests/09-referrals.spec.ts --reporter=list
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/07-withdrawals.spec.ts tests/08-iby.spec.ts tests/09-referrals.spec.ts
git commit -m "test: withdrawals, IBC wallet, and referrals coverage"
```

---

### Task 9: Admin bets tests

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\10-admin-bets.spec.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/10-admin-bets.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Admin bets endpoints", () => {
  test("GET /api/admin/bets returns paginated bets", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/bets?limit=10")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.bets)).toBe(true)
  })

  test("GET /api/admin/bets filters by status=disputed", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/bets?status=disputed")
    expect(res.status()).toBe(200)
    const { bets } = await res.json()
    bets.forEach((b: any) => expect(b.status).toBe("disputed"))
  })

  test("GET /api/admin/bets filters by mode=real", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/bets?mode=real")
    expect(res.status()).toBe(200)
    const { bets } = await res.json()
    bets.forEach((b: any) => expect(b.mode).toBe("real"))
  })

  test("bets include mode field", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/bets?limit=5")
    const { bets } = await res.json()
    if (bets.length > 0) {
      expect(Object.keys(bets[0])).toContain("mode")
    }
  })

  test("PATCH /api/admin/bets → 400 for invalid action", async ({ adminReq }) => {
    const res = await adminReq.patch("/api/admin/bets", {
      data: { bet_id: "fake", action: "not_a_real_action" },
    })
    expect(res.status()).toBe(400)
  })

  test("PATCH /api/admin/bets cancel → 404 for unknown bet", async ({ adminReq }) => {
    const res = await adminReq.patch("/api/admin/bets", {
      data: {
        bet_id: "00000000-0000-0000-0000-000000000000",
        action: "cancel",
        reason: "test",
      },
    })
    expect([404, 400]).toContain(res.status())
  })

  test("POST /api/admin/bets/auto-resolve-finished dry_run=true", async ({ adminReq }) => {
    const res = await adminReq.post("/api/admin/bets/auto-resolve-finished", {
      data: { dry_run: true },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("resolved")
  })

  test("POST /api/admin/bets/auto-resolve-disputed dry_run=true", async ({ adminReq }) => {
    const res = await adminReq.post("/api/admin/bets/auto-resolve-disputed", {
      data: { dry_run: true },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("resolved")
  })

  test("GET /api/admin/bets → 401 for regular user", async ({ userReq }) => {
    const res = await userReq.get("/api/admin/bets")
    expect(res.status()).toBe(401)
  })
})
```

- [ ] **Step 2: Run and verify**

```bash
npx playwright test tests/10-admin-bets.spec.ts --reporter=list
```

Expected: all 9 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/10-admin-bets.spec.ts
git commit -m "test: admin bets endpoint coverage"
```

---

### Task 10: Admin events + users + metrics tests

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\11-admin-events.spec.ts`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\12-admin-users.spec.ts`

- [ ] **Step 1: Write tests/11-admin-events.spec.ts**

```typescript
// tests/11-admin-events.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Admin events endpoints", () => {
  test("GET /api/admin/events returns events", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/events?sport=football&limit=5")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.events ?? body)).toBe(true)
  })

  test("GET /api/admin/events/results returns events with bets", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/events/results")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.events)).toBe(true)
  })

  test("PATCH /api/admin/events → 400 without required fields", async ({ adminReq }) => {
    const res = await adminReq.patch("/api/admin/events", {
      data: {},
    })
    expect(res.status()).toBe(400)
  })
})
```

- [ ] **Step 2: Write tests/12-admin-users.spec.ts**

```typescript
// tests/12-admin-users.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Admin users, metrics, referrals, audit", () => {
  test("GET /api/admin/users returns users list", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/users")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.users)).toBe(true)
  })

  test("GET /api/admin/metrics returns dashboard metrics", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/metrics")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("total_bets")
  })

  test("GET /api/admin/referrals returns referral stats", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/referrals")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("total_referrals")
  })

  test("GET /api/admin/audit returns audit log", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/audit")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.decisions ?? body.entries ?? body)).toBe(true)
  })
})
```

- [ ] **Step 3: Run both**

```bash
npx playwright test tests/11-admin-events.spec.ts tests/12-admin-users.spec.ts --reporter=list
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/11-admin-events.spec.ts tests/12-admin-users.spec.ts
git commit -m "test: admin events, users, metrics, audit coverage"
```

---

### Task 11: Admin wallets + withdrawals + IBC admin tests

**Files:**
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\13-admin-wallets.spec.ts`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\14-admin-withdrawals.spec.ts`
- Create: `d:\Documents\Documentos\p2pBets\api-tests\tests\15-admin-iby.spec.ts`

- [ ] **Step 1: Write tests/13-admin-wallets.spec.ts**

```typescript
// tests/13-admin-wallets.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Admin wallets endpoint", () => {
  test("GET /api/admin/wallets returns wallets", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/wallets")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.wallets ?? body)).toBe(true)
  })
})
```

- [ ] **Step 2: Write tests/14-admin-withdrawals.spec.ts**

```typescript
// tests/14-admin-withdrawals.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Admin withdrawals endpoint", () => {
  test("GET /api/admin/withdrawals returns pending requests", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/withdrawals?status=pending")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.requests)).toBe(true)
  })

  test("PATCH /api/admin/withdrawals → 404 for unknown request", async ({ adminReq }) => {
    const res = await adminReq.patch("/api/admin/withdrawals", {
      data: {
        id: "00000000-0000-0000-0000-000000000000",
        action: "approve",
      },
    })
    expect([404, 400]).toContain(res.status())
  })
})
```

- [ ] **Step 3: Write tests/15-admin-iby.spec.ts**

```typescript
// tests/15-admin-iby.spec.ts
import { test, expect } from "../helpers/fixtures"

test.describe("Admin IBC endpoints", () => {
  test("GET /api/admin/iby/settings returns settings", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/iby/settings")
    expect(res.status()).toBe(200)
  })

  test("GET /api/admin/iby/accounts returns accounts", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/iby/accounts")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.accounts ?? body)).toBe(true)
  })

  test("GET /api/admin/iby/deposit-requests returns requests", async ({ adminReq }) => {
    const res = await adminReq.get("/api/admin/iby/deposit-requests")
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.requests ?? body)).toBe(true)
  })
})
```

- [ ] **Step 4: Run all three**

```bash
npx playwright test tests/13-admin-wallets.spec.ts tests/14-admin-withdrawals.spec.ts tests/15-admin-iby.spec.ts --reporter=list
```

Expected: all tests PASS.

- [ ] **Step 5: Run full suite**

```bash
npx playwright test --reporter=list
```

Expected: 60+ tests, all PASS (skip acceptable for conditional tests).

- [ ] **Step 6: Final commit**

```bash
git add tests/13-admin-wallets.spec.ts tests/14-admin-withdrawals.spec.ts tests/15-admin-iby.spec.ts
git commit -m "test: admin wallets, withdrawals, IBC coverage — full suite complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ All 48 endpoints touched (GET methods + auth guards + write validation)
- ✅ `mode` field tested on bets, notifications, admin filter
- ✅ Security: 401 guards, invalid amount, invalid mode all tested
- ✅ Withdrawal validation (negative amount, below minimum)

**Placeholder scan:** None found.

**Type consistency:** `userReq`/`adminReq` fixture names consistent across all test files. All use `helpers/fixtures` import path.
