// Frankfurter.app — ECB official rates, free, no key required
// Covers all Tier 1 currencies. Updated once daily ~16:00 CET.

const OFFICIAL_CODES = ["MXN", "BRL"]

const FETCH_TIMEOUT_MS = 10_000

let _batch: { rates: Record<string, number>; fetchedAt: number } | null = null

async function fetchBatch(): Promise<Record<string, number>> {
  const symbols = OFFICIAL_CODES.join(",")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${symbols}`, {
      cache: "no-store",
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`)
  const json = await res.json()
  if (!json.rates) throw new Error("Frankfurter: no rates in response")
  return json.rates as Record<string, number>
}

// In-process cache to avoid duplicate fetches within same serverless invocation
export async function getOfficialRate(currency: string): Promise<number> {
  const now = Date.now()
  if (!_batch || now - _batch.fetchedAt > 60_000) {
    const rates = await fetchBatch()
    _batch = { rates, fetchedAt: now }
  }
  const rate = _batch.rates[currency]
  if (!rate) throw new Error(`Frankfurter: no rate for ${currency}`)
  return rate
}
