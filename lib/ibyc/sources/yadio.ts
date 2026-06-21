// yadio.io — VES parallel market rate (P2P aggregator including Binance Venezuela)
// Free, no key, updated ~every 15 min. Returns USD/VES exchange rate.

const PRIMARY_URL = "https://yadio.io/api/exrate/USD/VES"
const FALLBACK_URL = "https://pydolarve.org/api/v1/dollar?monitor=enparalelovzla"
const FETCH_TIMEOUT_MS = 10_000

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  return fetch(url, { cache: "no-store", signal: controller.signal }).finally(() => clearTimeout(timer))
}

export async function getVESRate(): Promise<number> {
  try {
    return await fetchYadio()
  } catch (err) {
    console.warn("yadio.io failed, trying pydolarve fallback:", err)
    return await fetchPydolarve()
  }
}

async function fetchYadio(): Promise<number> {
  const res = await fetchWithTimeout(PRIMARY_URL)
  if (!res.ok) throw new Error(`yadio HTTP ${res.status}`)
  const json = await res.json()
  // Try multiple known response shapes
  const rate =
    json?.USD?.VES ??          // { "USD": { "VES": 65.5 } }
    json?.VES ??               // { "VES": 65.5 }
    json?.rate ??              // { "rate": 65.5 }
    json?.price ??             // { "price": 65.5 }
    json?.ask ??               // { "ask": 65.5 }
    json?.promedio             // { "promedio": 65.5 }
  if (!rate || typeof rate !== "number") throw new Error(`yadio: unexpected response shape: ${JSON.stringify(json).slice(0, 120)}`)
  return rate
}

async function fetchPydolarve(): Promise<number> {
  const res = await fetchWithTimeout(FALLBACK_URL)
  if (!res.ok) throw new Error(`pydolarve HTTP ${res.status}`)
  const json = await res.json()
  const rate =
    json?.price ??
    json?.promedio ??
    json?.monitors?.enparalelovzla?.price ??
    json?.monitors?.bcv?.price
  if (!rate || typeof rate !== "number") throw new Error(`pydolarve: unexpected response shape: ${JSON.stringify(json).slice(0, 120)}`)
  return rate
}
