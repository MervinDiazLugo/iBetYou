import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { getHouseWalletBalances, houseWalletDebit, houseWalletCredit } from "@/lib/house-wallet"

const LOW_BALANCE_THRESHOLD = 500_000

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  const balances = await getHouseWalletBalances(supabase)

  const { data: openBets } = await supabase
    .from("bets")
    .select("event_id, creator_selection, bet_type, potential_payout, amount, mode")
    .eq("house_bet", true)
    .eq("status", "taken")

  const fantasyExposure = (openBets || [])
    .filter(b => b.mode === "fantasy")
    .reduce((sum, b) => sum + (Number(b.potential_payout) - Number(b.amount)), 0)

  const realExposure = (openBets || [])
    .filter(b => b.mode === "real")
    .reduce((sum, b) => sum + (Number(b.potential_payout) - Number(b.amount)), 0)

  const alerts: string[] = []
  if (balances.balance_fantasy < LOW_BALANCE_THRESHOLD) {
    alerts.push(`Saldo fantasy bajo: ${balances.balance_fantasy.toLocaleString("es-ES")} tokens (mínimo recomendado: ${LOW_BALANCE_THRESHOLD.toLocaleString("es-ES")})`)
  }
  if (balances.balance_real < LOW_BALANCE_THRESHOLD) {
    alerts.push(`Saldo real bajo: ${balances.balance_real.toLocaleString("es-ES")} (mínimo recomendado: ${LOW_BALANCE_THRESHOLD.toLocaleString("es-ES")})`)
  }

  return NextResponse.json({
    balances,
    exposure: { fantasy: fantasyExposure, real: realExposure },
    openBetsCount: (openBets || []).length,
    alerts,
  })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const body = await request.json()
  const { action, amount, mode } = body as {
    action?: "fund" | "withdraw"
    amount?: number
    mode?: "fantasy" | "real"
  }

  if (!action || !amount || !mode) {
    return NextResponse.json({ error: "action, amount, and mode are required" }, { status: 400 })
  }
  if (action !== "fund" && action !== "withdraw") {
    return NextResponse.json({ error: "action must be fund or withdraw" }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
  }
  if (mode !== "fantasy" && mode !== "real") {
    return NextResponse.json({ error: "mode must be fantasy or real" }, { status: 400 })
  }

  try {
    if (action === "fund") {
      await houseWalletCredit(supabase, amount, mode)
    } else {
      await houseWalletDebit(supabase, amount, mode)
    }
    const balances = await getHouseWalletBalances(supabase)
    return NextResponse.json({ success: true, balances })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Operation failed" }, { status: 400 })
  }
}
