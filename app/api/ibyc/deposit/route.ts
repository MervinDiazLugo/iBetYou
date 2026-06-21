import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { getRate } from "@/lib/ibyc/rate-service"
import { getCurrency, getPaymentInstructions, PAYMENT_METHODS, type PaymentMethod } from "@/lib/ibyc/config"

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { currency: rawCurrency, amount_local: rawAmount, payment_method, contact_whatsapp } = body

  const currency = String(rawCurrency ?? "").toUpperCase()
  const amountLocal = Number(rawAmount)

  if (!currency || !getCurrency(currency)) {
    return NextResponse.json({ error: "Moneda no soportada" }, { status: 400 })
  }
  if (!payment_method || !PAYMENT_METHODS.includes(payment_method)) {
    return NextResponse.json({ error: "Método de pago inválido" }, { status: 400 })
  }
  if (!amountLocal || amountLocal <= 0 || isNaN(amountLocal)) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 })
  }

  const cfg = getCurrency(currency)!
  if (amountLocal < cfg.minDepositLocal) {
    return NextResponse.json(
      { error: `Monto mínimo: ${cfg.minDepositLocal} ${cfg.symbol}` },
      { status: 400 }
    )
  }

  let rateResult
  try {
    rateResult = await getRate(currency)
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "No se pudo obtener la tasa. Intente más tarde." }, { status: 503 })
  }

  if (currency !== "USD" && rateResult.rateToUsd <= 0) {
    return NextResponse.json({ error: "Tasa de cambio inválida. Intente más tarde." }, { status: 503 })
  }
  const amountIbyc = currency === "USD" ? amountLocal : amountLocal / rateResult.rateToUsd
  if (amountIbyc < 0.01) {
    return NextResponse.json({ error: "Monto insuficiente para generar al menos 0.01 iBYC" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()
  const { data: deposit, error } = await supabase
    .from("ibeyc_deposits")
    .insert({
      user_id: userId,
      currency,
      amount_local: amountLocal,
      rate_to_usd: rateResult.rateToUsd,
      rate_tier: rateResult.tier,
      rate_source: rateResult.source,
      rate_fetched_at: rateResult.fetchedAt,
      rate_is_cached: rateResult.isCached,
      amount_ibyc: amountIbyc,
      payment_method,
      contact_whatsapp: contact_whatsapp ?? null,
      status: "pending",
    })
    .select("id, amount_ibyc, currency, amount_local, rate_to_usd, created_at")
    .single()

  if (error || !deposit) {
    return NextResponse.json({ error: "Error creando depósito" }, { status: 500 })
  }

  const paymentInstructions = getPaymentInstructions(currency, payment_method as PaymentMethod)

  return NextResponse.json({
    deposit,
    payment_instructions: paymentInstructions,
    rate: rateResult,
    amount_ibyc: amountIbyc,
  })
}
