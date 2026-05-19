import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { createNotification } from "@/lib/notifications"

const MIN_WITHDRAWAL = 100
const FEE_RATE = 0.06
const KYC_THRESHOLD = 1000

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select("*, method:withdrawal_methods(type, label)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data || [] })
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()
  const body = await request.json()
  const { method_id, amount } = body

  if (!amount || typeof amount !== "number" || amount <= 0 || !Number.isFinite(amount)) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 })
  }

  const numAmount = Number(amount)
  if (!Number.isFinite(numAmount) || numAmount < MIN_WITHDRAWAL) {
    return NextResponse.json(
      { error: `Monto mínimo de retiro: ${MIN_WITHDRAWAL} IBC` },
      { status: 400 }
    )
  }

  const { data: method } = await supabase
    .from("withdrawal_methods")
    .select("id, type, label, details")
    .eq("id", method_id)
    .eq("user_id", userId)
    .single()

  if (!method) {
    return NextResponse.json({ error: "Método de retiro no encontrado" }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("kyc_status")
    .eq("id", userId)
    .single()

  const { data: prevRequests } = await supabase
    .from("withdrawal_requests")
    .select("amount")
    .eq("user_id", userId)
    .in("status", ["pending", "processing", "paid"])

  const prevTotal = (prevRequests || []).reduce((sum, r) => sum + Number(r.amount), 0)

  if (prevTotal + numAmount > KYC_THRESHOLD && profile?.kyc_status !== "approved") {
    return NextResponse.json(
      {
        error: "Verificación KYC requerida para retiros que superen $1,000 acumulados.",
        kyc_required: true,
      },
      { status: 403 }
    )
  }

  const { data: ibcWallet } = await supabase
    .from("iby_wallets")
    .select("balance, balance_blocked")
    .eq("user_id", userId)
    .single()

  const available = ibcWallet ? Number(ibcWallet.balance) - Number(ibcWallet.balance_blocked) : 0

  if (available < numAmount) {
    return NextResponse.json({ error: "Saldo IBC insuficiente" }, { status: 400 })
  }

  const fee_amount = numAmount * FEE_RATE
  const net_amount = numAmount - fee_amount

  const { error: lockError } = await supabase.rpc("lock_withdrawal_funds", {
    p_user_id: userId,
    p_amount: numAmount,
  })

  if (lockError) {
    return NextResponse.json({ error: "Error al bloquear fondos" }, { status: 500 })
  }

  const { data: req, error: reqError } = await supabase
    .from("withdrawal_requests")
    .insert({
      user_id: userId,
      method_id: method.id,
      method_snapshot: { type: method.type, label: method.label, details: method.details },
      amount: numAmount,
      fee_amount,
      net_amount,
    })
    .select()
    .single()

  if (reqError) {
    await supabase.rpc("refund_withdrawal", { p_user_id: userId, p_amount: numAmount })
    return NextResponse.json({ error: "Error al crear solicitud de retiro" }, { status: 500 })
  }

  return NextResponse.json({ request: req })
}
