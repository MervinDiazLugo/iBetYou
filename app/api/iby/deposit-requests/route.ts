import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  const { data: requests, error } = await supabase
    .from("deposit_requests")
    .select(`
      id, transaction_id, amount, iby_coins, transaction_date,
      status, rejection_reason, created_at, reviewed_at,
      deposit_account:deposit_accounts(type, label)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ requests: requests || [] })
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 })

  const { transaction_id, deposit_account_id, amount, transaction_date } = body

  if (!transaction_id?.trim()) return NextResponse.json({ error: "ID de transacción requerido" }, { status: 400 })
  if (!deposit_account_id) return NextResponse.json({ error: "Cuenta de depósito requerida" }, { status: 400 })
  if (!amount || Number(amount) <= 0) return NextResponse.json({ error: "Monto inválido" }, { status: 400 })
  if (!transaction_date) return NextResponse.json({ error: "Fecha requerida" }, { status: 400 })

  const supabase = createAdminSupabaseClient()

  // Fetch current price to pre-calculate iby_coins
  const { data: priceSetting } = await supabase
    .from("iby_settings")
    .select("value")
    .eq("key", "iby_coin_price")
    .single()

  const price = Number(priceSetting?.value || 1)
  const iby_coins = Number(amount) / price

  const { data: req, error } = await supabase
    .from("deposit_requests")
    .insert({
      user_id: userId,
      deposit_account_id,
      transaction_id: transaction_id.trim(),
      amount: Number(amount),
      iby_coins,
      transaction_date,
    })
    .select("id, status, created_at")
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ese ID de transacción ya fue reportado" }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, request: req }, { status: 201 })
}
