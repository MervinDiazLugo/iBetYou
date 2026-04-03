import { createAdminSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedUserId, requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  try {
    const userIdFromQuery = request.nextUrl.searchParams.get("user_id")
    const requesterId = await getAuthenticatedUserId(request)

    if (!requesterId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    let userId = requesterId
    if (userIdFromQuery && userIdFromQuery !== requesterId) {
      const adminAuth = await requireBackofficeAdmin(request)
      if (!adminAuth.authorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      userId = userIdFromQuery
    }

    const supabase = createAdminSupabaseClient()

    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      )
    }

    // Get wallet
    const { data: wallet } = await supabase
      .from("wallets")
      .select("balance_fantasy, balance_real, fantasy_total_accumulated")
      .eq("user_id", userId)
      .single()

    // Get bets for stats
    const { data: bets } = await supabase
      .from("bets")
      .select("status")
      .or(`creator_id.eq.${userId},acceptor_id.eq.${userId}`)

    const totalBets = bets?.length || 0
    const wonBets = bets?.filter((b) => b.status === "resolved").length || 0
    const winRate = totalBets > 0 ? Math.round((wonBets / totalBets) * 100) : 0

    return NextResponse.json({
      success: true,
      profile,
      wallet,
      stats: {
        total_bets: totalBets,
        won_bets: wonBets,
        win_rate: winRate,
        current_streak: 0,
      },
    })
  } catch (error) {
    console.error("Get profile error:", error)
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    )
  }
}
