import { NextRequest, NextResponse } from "next/server"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { setRateOverride } from "@/lib/ibyc/rate-service"
import { getCurrency } from "@/lib/ibyc/config"

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { currency: rawCurrency, rate } = await request.json()
  const currency = String(rawCurrency ?? "").toUpperCase()

  if (!currency || !getCurrency(currency)) return NextResponse.json({ error: "Moneda no soportada" }, { status: 400 })
  if (!rate || Number(rate) <= 0) return NextResponse.json({ error: "Tasa inválida" }, { status: 400 })

  await setRateOverride(currency, Number(rate), auth.userId!)

  return NextResponse.json({ success: true, currency, rate: Number(rate), note: "Override activo por 4 horas" })
}
