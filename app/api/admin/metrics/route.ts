import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  try {
    // All bets with relevant fields
    const { data: bets, error: betsError } = await supabase
      .from("bets")
      .select("id, status, amount, fee_amount, multiplier, type, bet_type, created_at, resolved_at")

    if (betsError) return NextResponse.json({ error: betsError.message }, { status: 500 })

    // All wallets
    const { data: wallets, error: walletsError } = await supabase
      .from("wallets")
      .select("balance_fantasy, balance_real")

    if (walletsError) return NextResponse.json({ error: walletsError.message }, { status: 500 })

    const allBets = bets || []
    const allWallets = wallets || []

    // ── Bet counts by status ──────────────────────────────────────────────
    const statusCounts: Record<string, number> = {}
    for (const bet of allBets) {
      statusCounts[bet.status] = (statusCounts[bet.status] || 0) + 1
    }

    // ── Bet type breakdown ────────────────────────────────────────────────
    const typeCounts: Record<string, number> = {}
    for (const bet of allBets) {
      typeCounts[bet.bet_type] = (typeCounts[bet.bet_type] || 0) + 1
    }

    // ── Fees ──────────────────────────────────────────────────────────────
    // Only resolved bets generate real fee revenue (cancelled bets refund the fee)
    const feesCollected = allBets
      .filter((b) => b.status === "resolved")
      .reduce((sum, b) => sum + Number(b.fee_amount || 0), 0)

    const feesPending = allBets
      .filter((b) => ["open", "taken", "pending_resolution", "pending_resolution_creator", "pending_resolution_acceptor", "disputed"].includes(b.status))
      .reduce((sum, b) => sum + Number(b.fee_amount || 0), 0)

    const feesTotal = allBets
      .reduce((sum, b) => sum + Number(b.fee_amount || 0), 0)

    // ── Money locked in active bets ───────────────────────────────────────
    // Open: creator locked amount + fee
    const lockedOpen = allBets
      .filter((b) => b.status === "open")
      .reduce((sum, b) => sum + Number(b.amount || 0) + Number(b.fee_amount || 0), 0)

    // Taken/active: creator amount + acceptor amount (amount * multiplier for asymmetric, amount for symmetric) + fee
    const activeBets = allBets.filter((b) =>
      ["taken", "pending_resolution", "pending_resolution_creator", "pending_resolution_acceptor", "disputed"].includes(b.status)
    )
    const lockedActive = activeBets.reduce((sum, b) => {
      const creatorStake = Number(b.amount || 0)
      const acceptorStake = b.type === "asymmetric"
        ? Number(b.amount || 0) * Number(b.multiplier || 1)
        : Number(b.amount || 0)
      const fee = Number(b.fee_amount || 0)
      return sum + creatorStake + acceptorStake + fee
    }, 0)

    // ── Volume ────────────────────────────────────────────────────────────
    const totalVolume = allBets.reduce((sum, b) => sum + Number(b.amount || 0), 0)
    const resolvedVolume = allBets
      .filter((b) => b.status === "resolved")
      .reduce((sum, b) => sum + Number(b.amount || 0), 0)

    // ── Wallet totals ─────────────────────────────────────────────────────
    const totalWalletBalance = allWallets.reduce((sum, w) => sum + Number(w.balance_fantasy || 0), 0)
    const totalWalletReal = allWallets.reduce((sum, w) => sum + Number(w.balance_real || 0), 0)
    const walletsWithBalance = allWallets.filter((w) => Number(w.balance_fantasy || 0) > 0).length

    // ── Resolved bets stats ───────────────────────────────────────────────
    const resolvedBets = allBets.filter((b) => b.status === "resolved")
    const avgBetAmount = allBets.length > 0 ? totalVolume / allBets.length : 0
    const avgFeePerResolvedBet = resolvedBets.length > 0 ? feesCollected / resolvedBets.length : 0

    return NextResponse.json({
      bets: {
        total: allBets.length,
        byStatus: statusCounts,
        byType: typeCounts,
        totalVolume,
        resolvedVolume,
        avgBetAmount,
      },
      fees: {
        collected: feesCollected,
        pending: feesPending,
        total: feesTotal,
        avgPerResolvedBet: avgFeePerResolvedBet,
      },
      locked: {
        inOpenBets: lockedOpen,
        inActiveBets: lockedActive,
        total: lockedOpen + lockedActive,
      },
      wallets: {
        totalBalanceFantasy: totalWalletBalance,
        totalBalanceReal: totalWalletReal,
        totalWallets: allWallets.length,
        walletsWithBalance,
      },
    })
  } catch (error) {
    console.error("Metrics error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
