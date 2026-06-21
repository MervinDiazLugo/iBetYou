import { NextRequest, NextResponse } from "next/server"
import { getRate } from "@/lib/ibyc/rate-service"
import { getCurrency } from "@/lib/ibyc/config"

export async function GET(request: NextRequest) {
  const currency = request.nextUrl.searchParams.get("currency")?.toUpperCase()
  if (!currency) return NextResponse.json({ error: "currency requerido" }, { status: 400 })
  if (!getCurrency(currency)) return NextResponse.json({ error: `Moneda no soportada: ${currency}` }, { status: 400 })

  try {
    const result = await getRate(currency)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Error obteniendo tasa" }, { status: 503 })
  }
}
