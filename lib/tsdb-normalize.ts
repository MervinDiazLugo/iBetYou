export interface TvChannel { name: string; country: string; logo: string | null }
export interface TvImages { thumb: string | null; poster: string | null; banner: string | null }
export interface EventStat { stat: string; home: number | null; away: number | null }

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function normalizeTvChannels(raw: any[]): { channels: TvChannel[]; images: TvImages } {
  const list = Array.isArray(raw) ? raw : []
  const channels: TvChannel[] = list
    .filter((c) => (c?.strChannel || "").trim().length > 0)
    .map((c) => ({ name: c.strChannel, country: c.strCountry || "", logo: c.strLogo || null }))
  const first = list[0] || {}
  return {
    channels,
    images: {
      thumb: first.strEventThumb || null,
      poster: first.strEventPoster || null,
      banner: first.strEventBanner || null,
    },
  }
}

export function normalizeEventStats(raw: any[]): EventStat[] {
  const list = Array.isArray(raw) ? raw : []
  return list
    .filter((s) => (s?.strStat || "").trim().length > 0)
    .map((s) => ({ stat: s.strStat, home: num(s.intHome), away: num(s.intAway) }))
}
