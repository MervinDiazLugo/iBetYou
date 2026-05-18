export type BetMode = "fantasy" | "real"

const KEY = "iby_mode"

export function getStoredMode(): BetMode {
  if (typeof window === "undefined") return "fantasy"
  const stored = localStorage.getItem(KEY)
  return stored === "real" ? "real" : "fantasy"
}

export function storeMode(mode: BetMode) {
  localStorage.setItem(KEY, mode)
}
