export type CurrencyTier = "official" | "parallel"
export type RateSource = "frankfurter" | "open_er" | "yadio" | "bluelytics"

export interface CurrencyConfig {
  code: string
  name: string
  symbol: string
  country: string
  flag: string
  tier: CurrencyTier
  source: RateSource
  markup: number       // multiplier on official rate (1.0 = no markup, 1.25 = +25%)
  ttlSeconds: number
  minDepositLocal: number
  minWithdrawLocal: number
  legalNote?: string
}

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  {
    code: "USD", name: "Dólar estadounidense", symbol: "$", country: "Internacional", flag: "🌎",
    tier: "official", source: "frankfurter", markup: 1.0, ttlSeconds: 0,
    minDepositLocal: 1, minWithdrawLocal: 1,
  },
  {
    code: "VES", name: "Bolívar venezolano", symbol: "Bs.", country: "Venezuela", flag: "🇻🇪",
    tier: "official", source: "open_er", markup: 1.25, ttlSeconds: 1200,
    minDepositLocal: 50, minWithdrawLocal: 50,
    legalNote: "Tasa BCV oficial con margen del 25%.",
  },
  {
    code: "ARS", name: "Peso argentino", symbol: "$", country: "Argentina", flag: "🇦🇷",
    tier: "parallel", source: "bluelytics", markup: 1.0, ttlSeconds: 1200,
    minDepositLocal: 1000, minWithdrawLocal: 1000,
    legalNote: "Tasa del dólar blue (mercado informal). Uso bajo responsabilidad del usuario.",
  },
  {
    code: "MXN", name: "Peso mexicano", symbol: "$", country: "México", flag: "🇲🇽",
    tier: "official", source: "frankfurter", markup: 1.0, ttlSeconds: 21600,
    minDepositLocal: 20, minWithdrawLocal: 20,
  },
  {
    code: "COP", name: "Peso colombiano", symbol: "$", country: "Colombia", flag: "🇨🇴",
    tier: "official", source: "open_er", markup: 1.0, ttlSeconds: 21600,
    minDepositLocal: 4000, minWithdrawLocal: 4000,
  },
  {
    code: "BRL", name: "Real brasileño", symbol: "R$", country: "Brasil", flag: "🇧🇷",
    tier: "official", source: "frankfurter", markup: 1.0, ttlSeconds: 21600,
    minDepositLocal: 5, minWithdrawLocal: 5,
  },
]

export const CURRENCY_MAP = Object.fromEntries(SUPPORTED_CURRENCIES.map(c => [c.code, c]))

export const WITHDRAWAL_FEE_RATE = 0.06

export function getCurrency(code: string): CurrencyConfig | null {
  return CURRENCY_MAP[code] ?? null
}

export const PAYMENT_METHODS = ["binance", "bank_transfer"] as const
export type PaymentMethod = typeof PAYMENT_METHODS[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  binance: "Binance P2P",
  bank_transfer: "Transferencia bancaria",
}

// Payment details shown to the user after creating a deposit
// Set these via environment variables
export function getPaymentInstructions(currency: string, method: PaymentMethod): string {
  if (method === "binance") {
    const binanceId = process.env.IBYC_BINANCE_ID ?? "N/A"
    return `Binance ID: ${binanceId}`
  }
  const key = `IBYC_BANK_${currency}`
  return process.env[key] ?? process.env.IBYC_BANK_DEFAULT ?? "Contacta al soporte para obtener datos bancarios."
}
