import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)

  const from = searchParams.get("from") || null
  const to = searchParams.get("to") || null
  const operation = searchParams.get("operation") || null
  const tokenType = searchParams.get("token_type") || null
  const userId = searchParams.get("user_id") || null
  const limit = Math.min(parseInt(searchParams.get("limit") || "50") || 50, 100)
  const offset = Math.max(parseInt(searchParams.get("offset") || "0") || 0, 0)

  try {
    // ── Build transaction query ───────────────────────────────────────────
    let txQuery = supabase
      .from("transactions")
      .select(`
        id,
        user_id,
        token_type,
        amount,
        operation,
        reference_id,
        created_at,
        profile:profiles!user_id(nickname, email)
      `, { count: "exact" })
      .order("created_at", { ascending: false })

    if (from) txQuery = txQuery.gte("created_at", from)
    if (to) txQuery = txQuery.lte("created_at", to)
    if (operation) txQuery = txQuery.eq("operation", operation)
    if (tokenType) txQuery = txQuery.eq("token_type", tokenType)
    if (userId) txQuery = txQuery.eq("user_id", userId)

    txQuery = txQuery.range(offset, offset + limit - 1)

    // ── Summary query (no pagination, same filters) ───────────────────────
    let summaryQuery = supabase
      .from("transactions")
      .select("amount, operation, token_type")

    if (from) summaryQuery = summaryQuery.gte("created_at", from)
    if (to) summaryQuery = summaryQuery.lte("created_at", to)
    if (operation) summaryQuery = summaryQuery.eq("operation", operation)
    if (tokenType) summaryQuery = summaryQuery.eq("token_type", tokenType)
    if (userId) summaryQuery = summaryQuery.eq("user_id", userId)

    // ── Wallet snapshot ───────────────────────────────────────────────────
    const walletsQuery = supabase
      .from("wallets")
      .select("balance_fantasy, balance_real")

    // ── Bets locked ───────────────────────────────────────────────────────
    const lockedBetsQuery = supabase
      .from("bets")
      .select("status, amount, fee_amount, multiplier, type")
      .in("status", ["open", "taken", "pending_resolution", "pending_resolution_creator", "pending_resolution_acceptor", "disputed"])

    const [txResult, summaryResult, walletsResult, lockedResult] = await Promise.all([
      txQuery,
      summaryQuery,
      walletsQuery,
      lockedBetsQuery,
    ])

    if (txResult.error) return NextResponse.json({ error: txResult.error.message }, { status: 500 })
    if (summaryResult.error) return NextResponse.json({ error: summaryResult.error.message }, { status: 500 })

    // ── Compute summary ───────────────────────────────────────────────────
    const summaryRows = summaryResult.data || []

    const byOperation: Record<string, { count: number; total: number }> = {}
    let totalIngresos = 0
    let totalEgresos = 0

    for (const row of summaryRows) {
      const amt = Number(row.amount)
      const op = row.operation || "unknown"

      if (!byOperation[op]) byOperation[op] = { count: 0, total: 0 }
      byOperation[op].count += 1
      byOperation[op].total += amt

      if (amt > 0) totalIngresos += amt
      else totalEgresos += Math.abs(amt)
    }

    // Fee revenue: only from resolved bets' fee_amount (creator fees)
    // Acceptor fees are embedded in the bet_taken deduction
    const { data: resolvedBets } = await supabase
      .from("bets")
      .select("fee_amount, amount, multiplier, type")
      .eq("status", "resolved")

    let creatorFeesTotal = 0
    let acceptorFeesTotal = 0
    for (const b of resolvedBets || []) {
      creatorFeesTotal += Number(b.fee_amount || 0)
      const acceptorStake = b.type === "asymmetric"
        ? Number(b.amount) * Number(b.multiplier || 1)
        : Number(b.amount)
      acceptorFeesTotal += acceptorStake * 0.03
    }
    const totalFeesEarned = creatorFeesTotal + acceptorFeesTotal

    // Prizes paid (bet_won* operations)
    const prizesPaid = summaryRows
      .filter((r) => r.operation?.startsWith("bet_won"))
      .reduce((s, r) => s + Number(r.amount), 0)

    // Refunds (bet_cancelled_refund, acceptor refunds)
    const refundsPaid = summaryRows
      .filter((r) => r.operation?.includes("refund") || r.operation?.includes("cancel"))
      .reduce((s, r) => s + Number(r.amount), 0)

    // Deposits
    const depositsTotal = summaryRows
      .filter((r) => r.operation === "deposit" || r.operation === "top_up" || r.operation === "login_bonus")
      .reduce((s, r) => s + Number(r.amount), 0)

    // ── Wallet snapshot ───────────────────────────────────────────────────
    const wallets = walletsResult.data || []
    const circulatingFantasy = wallets.reduce((s, w) => s + Number(w.balance_fantasy || 0), 0)
    const circulatingReal = wallets.reduce((s, w) => s + Number(w.balance_real || 0), 0)

    // ── Locked in active bets ─────────────────────────────────────────────
    const locked = (lockedResult.data || []).reduce((acc, b) => {
      const creatorAmt = Number(b.amount || 0)
      const acceptorStake = b.type === "asymmetric"
        ? creatorAmt * Number(b.multiplier || 1)
        : creatorAmt
      const fee = Number(b.fee_amount || 0)

      if (b.status === "open") {
        acc.open += creatorAmt + fee
      } else {
        acc.active += creatorAmt + acceptorStake + fee
      }
      return acc
    }, { open: 0, active: 0 })

    return NextResponse.json({
      summary: {
        // Arqueo de caja
        circulating_fantasy: circulatingFantasy,
        circulating_real: circulatingReal,
        locked_in_open_bets: locked.open,
        locked_in_active_bets: locked.active,
        total_in_system: circulatingFantasy + locked.open + locked.active,
        // Ingresos vs egresos (en el rango de fechas)
        total_ingresos: totalIngresos,
        total_egresos: totalEgresos,
        net: totalIngresos - totalEgresos,
        // Fees
        fees_earned_creator: creatorFeesTotal,
        fees_earned_acceptor: acceptorFeesTotal,
        fees_earned_total: totalFeesEarned,
        // Desglose
        prizes_paid: prizesPaid,
        refunds_paid: refundsPaid,
        deposits_total: depositsTotal,
      },
      by_operation: byOperation,
      transactions: txResult.data || [],
      total_count: txResult.count ?? 0,
      page: { offset, limit },
    })
  } catch (error: any) {
    console.error("Audit error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
