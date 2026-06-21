// VES exchange rate — sources tried in order:
// 1. pydolarve.org (parallel market, enparalelovzla)
// 2. open.er-api.com (official BCV rate — fallback)
// 3. exchangerate-api.com v4 (official BCV rate — last resort)
//
// Sources 2 & 3 return the BCV official rate, not parallel market.
// Parallel rate APIs (yadio.io, pydolarve.org) are unreliable — endpoint
// changes and timeouts are common. Official rate prevents total failure.

const PYDOLARVE_URL = "https://pydolarve.org/api/v1/dollar?monitor=enparalelovzla"
const OPEN_ER_URL = "https://open.er-api.com/v6/latest/USD"
const EXCHANGE_RATE_URL = "https://api.exchangerate-api.com/v4/latest/USD"
const FETCH_TIMEOUT_MS = 8_000

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { cache: "no-store", signal: controller.signal }).finally(() => clearTimeout(timer))
}

export async function getVESRate(): Promise<number> {
  // 1. Try parallel market rate (most accurate for Venezuela)
  try {
    const res = await fetchWithTimeout(PYDOLARVE_URL)
    if (res.ok) {
      const json = await res.json()
      // pydolarve v1: { "monitor": { "price": 65.5, ... } }
      const rate =
        json?.monitor?.price ??
        json?.monitors?.enparalelovzla?.price ??
        json?.price
      if (rate && typeof rate === "number" && rate > 0) return rate
    }
  } catch {
    // pydolarve unreachable — continue
  }

  // 2. Official BCV rate via open.er-api.com (no key, free, reliable)
  try {
    const res = await fetchWithTimeout(OPEN_ER_URL)
    if (res.ok) {
      const json = await res.json()
      const rate = json?.rates?.VES
      if (rate && typeof rate === "number" && rate > 0) return rate
    }
  } catch {
    // continue
  }

  // 3. Official BCV rate via exchangerate-api.com v4 (no key, free)
  const res = await fetchWithTimeout(EXCHANGE_RATE_URL)
  if (!res.ok) throw new Error(`exchangerate-api HTTP ${res.status}`)
  const json = await res.json()
  const rate = json?.rates?.VES
  if (!rate || typeof rate !== "number" || rate <= 0) {
    throw new Error(`exchangerate-api: VES not in response`)
  }
  return rate
}
