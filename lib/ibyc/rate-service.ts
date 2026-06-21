import { createAdminSupabaseClient } from "@/lib/supabase"
import { getCurrency, CURRENCY_MAP } from "./config"
import { getOfficialRate } from "./sources/frankfurter"
import { getOpenErRate } from "./sources/open-er"
import { getARSRate } from "./sources/bluelytics"

export interface RateResult {
  currency: string
  rateToUsd: number    // units of local currency per 1 USD — includes markup
  source: string
  tier: "official" | "parallel"
  markup: number       // multiplier applied (1.0 = none, 1.25 = +25%)
  fetchedAt: string    // ISO timestamp
  isCached: boolean
  expiresAt: string
}

export async function getRate(currency: string): Promise<RateResult> {
  if (currency === "USD") {
    const now = new Date().toISOString()
    return { currency: "USD", rateToUsd: 1, source: "direct", tier: "official", markup: 1.0, fetchedAt: now, isCached: false, expiresAt: now }
  }

  const cfg = getCurrency(currency)
  if (!cfg) throw new Error(`Moneda no soportada: ${currency}`)

  const supabase = createAdminSupabaseClient()
  const now = new Date()

  // Check DB cache
  const { data: cached } = await supabase
    .from("ibeyc_rate_cache")
    .select("*")
    .eq("currency", currency)
    .single()

  if (cached && new Date(cached.expires_at) > now) {
    return {
      currency,
      rateToUsd: Number(cached.rate_to_usd),
      source: cached.source,
      tier: cached.tier as "official" | "parallel",
      markup: cfg.markup,
      fetchedAt: cached.fetched_at,
      isCached: true,
      expiresAt: cached.expires_at,
    }
  }

  // Fetch fresh rate
  let rate: number
  let source: string
  const tier = cfg.tier
  try {
    if (cfg.source === "open_er") {
      rate = await getOpenErRate(currency)
      source = "open_er"
    } else if (cfg.source === "bluelytics") {
      rate = await getARSRate()
      source = "bluelytics"
    } else {
      rate = await getOfficialRate(currency)
      source = "frankfurter"
    }
  } catch (fetchErr: any) {
    console.error(`Rate fetch failed for ${currency}:`, fetchErr?.message ?? fetchErr)
    if (cached) {
      console.warn(`Using stale cache for ${currency} (expired at ${cached.expires_at})`)
      return {
        currency,
        rateToUsd: Number(cached.rate_to_usd),
        source: cached.source,
        tier: cached.tier as "official" | "parallel",
        markup: cfg.markup,
        fetchedAt: cached.fetched_at,
        isCached: true,
        expiresAt: cached.expires_at,
      }
    }
    throw new Error(`No se pudo obtener la tasa para ${currency}. Intente más tarde.`)
  }

  // Apply markup — rate stored in cache already includes markup
  const markedUpRate = rate * cfg.markup

  const fetchedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + cfg.ttlSeconds * 1000).toISOString()

  await supabase.from("ibeyc_rate_cache").upsert({
    currency,
    rate_to_usd: markedUpRate,
    source,
    tier,
    fetched_at: fetchedAt,
    expires_at: expiresAt,
  })

  return { currency, rateToUsd: markedUpRate, source, tier, markup: cfg.markup, fetchedAt, isCached: false, expiresAt }
}

// Admin can manually set a rate override (replaces cache with far-future expiry)
export async function setRateOverride(currency: string, rate: number, adminId: string): Promise<void> {
  const cfg = getCurrency(currency)
  if (!cfg) throw new Error(`Moneda no soportada: ${currency}`)
  const supabase = createAdminSupabaseClient()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 4 * 3600 * 1000).toISOString()
  const { error } = await supabase.from("ibeyc_rate_cache").upsert({
    currency,
    rate_to_usd: rate,
    source: `manual_override:${adminId}`,
    tier: cfg.tier,
    fetched_at: now.toISOString(),
    expires_at: expiresAt,
  })
  if (error) throw new Error(`Error guardando override de tasa: ${error.message}`)
}
