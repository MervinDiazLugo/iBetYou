// open.er-api.com — free, no key, covers 160+ currencies including VES, ARS, COP
// Updated multiple times daily. More coverage than ECB/Frankfurter.

const BASE_URL = "https://open.er-api.com/v6/latest/USD"
const FETCH_TIMEOUT_MS = 10_000

let _cache: { rates: Record<string, number>; fetchedAt: number } | null = null

async function fetchRates(): Promise<Record<string, number>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(BASE_URL, { cache: "no-store", signal: controller.signal })
    if (!res.ok) throw new Error(`open.er-api HTTP ${res.status}`)
    const json = await res.json()
    if (!json.rates) throw new Error("open.er-api: no rates in response")
    return json.rates as Record<string, number>
  } finally {
    clearTimeout(timer)
  }
}

export async function getOpenErRate(currency: string): Promise<number> {
  const now = Date.now()
  if (!_cache || now - _cache.fetchedAt > 60_000) {
    const rates = await fetchRates()
    _cache = { rates, fetchedAt: now }
  }
  const rate = _cache.rates[currency]
  if (!rate) throw new Error(`open.er-api: no rate for ${currency}`)
  return rate
}
