// yadio.io — VES parallel market rate (P2P aggregator including Binance Venezuela)
// Free, no key, updated ~every 15 min. Returns USD/VES exchange rate.

const PRIMARY_URL = "https://yadio.io/api/exrate/USD/VES"
const FALLBACK_URL = "https://pydolarve.org/api/v1/dollar?monitor=enparalelovzla"

export async function getVESRate(): Promise<number> {
  try {
    return await fetchYadio()
  } catch (err) {
    console.warn("yadio.io failed, trying pydolarve fallback:", err)
    return await fetchPydolarve()
  }
}

async function fetchYadio(): Promise<number> {
  const res = await fetch(PRIMARY_URL, { cache: "no-store" })
  if (!res.ok) throw new Error(`yadio HTTP ${res.status}`)
  const json = await res.json()
  // Response: { "USD": { "VES": 37.31 } } or similar
  const rate = json?.USD?.VES ?? json?.rate ?? json?.price
  if (!rate || typeof rate !== "number") throw new Error("yadio: unexpected response shape")
  return rate
}

async function fetchPydolarve(): Promise<number> {
  const res = await fetch(FALLBACK_URL, { cache: "no-store" })
  if (!res.ok) throw new Error(`pydolarve HTTP ${res.status}`)
  const json = await res.json()
  const rate = json?.price ?? json?.promedio ?? json?.monitors?.bcv?.price
  if (!rate || typeof rate !== "number") throw new Error("pydolarve: unexpected response shape")
  return rate
}
