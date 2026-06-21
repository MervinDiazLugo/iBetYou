// bluelytics.com.ar — Argentine dólar blue rate
// Free, no key, updated ~hourly.

const PRIMARY_URL = "https://api.bluelytics.com.ar/v2/latest"
const FALLBACK_URL = "https://dolarapi.com/v1/dolares/blue"

export async function getARSRate(): Promise<number> {
  try {
    return await fetchBluelytics()
  } catch (err) {
    console.warn("bluelytics failed, trying dolarapi fallback:", err)
    return await fetchDolarapi()
  }
}

async function fetchBluelytics(): Promise<number> {
  const res = await fetch(PRIMARY_URL, { cache: "no-store" })
  if (!res.ok) throw new Error(`bluelytics HTTP ${res.status}`)
  const json = await res.json()
  // Response: { blue: { value_sell: 1150.5, ... }, ... }
  const rate = json?.blue?.value_sell
  if (!rate || typeof rate !== "number") throw new Error("bluelytics: unexpected response shape")
  return rate
}

async function fetchDolarapi(): Promise<number> {
  const res = await fetch(FALLBACK_URL, { cache: "no-store" })
  if (!res.ok) throw new Error(`dolarapi HTTP ${res.status}`)
  const json = await res.json()
  const rate = json?.venta ?? json?.value_sell
  if (!rate || typeof rate !== "number") throw new Error("dolarapi: unexpected response shape")
  return rate
}
