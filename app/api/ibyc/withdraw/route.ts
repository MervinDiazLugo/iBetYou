import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { getRate } from "@/lib/ibyc/rate-service"
import { getCurrency, PAYMENT_METHODS, type PaymentMethod, WITHDRAWAL_FEE_RATE } from "@/lib/ibyc/config"

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { currency: rawCurrency, amount_ibyc: rawAmount, payment_method, payment_details, contact_whatsapp } = body

  const currency = String(rawCurrency ?? "").toUpperCase()
  const amountIbyc = Number(rawAmount)

  if (!currency || !getCurrency(currency)) return NextResponse.json({ error: "Moneda no soportada" }, { status: 400 })
  if (!payment_method || !PAYMENT_METHODS.includes(payment_method)) return NextResponse.json({ error: "Método de pago inválido" }, { status: 400 })
  if (!payment_details?.trim()) return NextResponse.json({ error: "Datos de pago requeridos (cuenta Binance o bancaria)" }, { status: 400 })
  if (!amountIbyc || amountIbyc <= 0 || isNaN(amountIbyc)) return NextResponse.json({ error: "Monto inválido" }, { status: 400 })
  if (amountIbyc < 1) return NextResponse.json({ error: "Monto mínimo de retiro: 1 iBYC" }, { status: 400 })

  const supabase = createAdminSupabaseClient()

  // Check balance (optimistic lock pattern)
  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance_real")
    .eq("user_id", userId)
    .single()

  if (!wallet) return NextResponse.json({ error: "Wallet no encontrada" }, { status: 404 })
  if (wallet.balance_real < amountIbyc) return NextResponse.json({ error: "Saldo iBYC insuficiente" }, { status: 400 })

  // Get current rate
  let rateResult
  try {
    rateResult = await getRate(currency)
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "No se pudo obtener la tasa" }, { status: 503 })
  }

  const feeIbyc = parseFloat((amountIbyc * WITHDRAWAL_FEE_RATE).toFixed(8))
  const netIbyc = parseFloat((amountIbyc - feeIbyc).toFixed(8))
  const amountLocal = currency === "USD" ? netIbyc : parseFloat((netIbyc * rateResult.rateToUsd).toFixed(2))

  const cfg = getCurrency(currency)!
  if (amountLocal < cfg.minWithdrawLocal) {
    return NextResponse.json(
      { error: `Monto neto mínimo para retiro: ${cfg.minWithdrawLocal} ${cfg.symbol}` },
      { status: 400 }
    )
  }

  // Debit wallet atomically (optimistic lock — rejects if balance changed since read)
  const { data: updatedWallet, error: debitError } = await supabase
    .from("wallets")
    .update({ balance_real: wallet.balance_real - amountIbyc })
    .eq("user_id", userId)
    .eq("balance_real", wallet.balance_real)
    .select("balance_real")
    .single()

  if (debitError || !updatedWallet) {
    if (debitError?.code === "PGRST116") {
      return NextResponse.json({ error: "Saldo cambió durante la operación. Intente de nuevo." }, { status: 409 })
    }
    return NextResponse.json({ error: "Error debitando saldo" }, { status: 500 })
  }

  // Create withdrawal record
  const { data: withdrawal, error: wErr } = await supabase
    .from("ibeyc_withdrawals")
    .insert({
      user_id: userId,
      currency,
      amount_ibyc_requested: amountIbyc,
      fee_ibyc: feeIbyc,
      amount_ibyc_net: netIbyc,
      rate_to_usd: rateResult.rateToUsd,
      rate_source: rateResult.source,
      amount_local: amountLocal,
      payment_method,
      payment_details: payment_details.trim(),
      contact_whatsapp: contact_whatsapp ?? null,
      status: "pending",
    })
    .select("id")
    .single()

  if (wErr || !withdrawal) {
    // Rollback: return funds using post-debit value as optimistic lock to avoid overwriting concurrent changes
    await supabase
      .from("wallets")
      .update({ balance_real: updatedWallet.balance_real + amountIbyc })
      .eq("user_id", userId)
      .eq("balance_real", updatedWallet.balance_real)
    return NextResponse.json({ error: "Error creando retiro" }, { status: 500 })
  }

  // Audit record
  await supabase.from("transactions").insert({
    user_id: userId,
    token_type: "real",
    amount: -amountIbyc,
    operation: "ibyc_withdrawal_request",
    reference_id: withdrawal.id,
  })

  return NextResponse.json({
    withdrawal_id: withdrawal.id,
    amount_ibyc_requested: amountIbyc,
    fee_ibyc: feeIbyc,
    amount_ibyc_net: netIbyc,
    amount_local: amountLocal,
    currency,
    rate: rateResult,
    new_balance: updatedWallet.balance_real,
  })
}
