import { createAdminSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(request)
    if (!authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { userId } = await request.json()
    if (userId && userId !== authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized user scope" }, { status: 403 })
    }

    const effectiveUserId = authenticatedUserId
    const supabase = createAdminSupabaseClient()

    // Admins never receive tokens — silent, no wallet changes
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", effectiveUserId)
      .single()

    if (profile?.role === "backoffice_admin") {
      return NextResponse.json({ success: false, bonus: 0 })
    }

    const { data: wallet } = await supabase
      .from("wallets")
      .select("balance_fantasy, fantasy_total_accumulated")
      .eq("user_id", effectiveUserId)
      .single()

    if (!wallet) {
      return NextResponse.json({ success: false, bonus: 0 })
    }

    // Phase 1: already received initial 10k balance — no-op
    if (Number(wallet.fantasy_total_accumulated) >= 10000) {
      return NextResponse.json({ success: false, bonus: 0 })
    }

    // One-time top-up: bring balance up to 10,000 and lock accumulated at 10,000
    // so this path never runs again for this user.
    const currentBalance = Number(wallet.balance_fantasy)
    const tokensToAdd = Math.max(0, 10000 - currentBalance)
    const newBalance = currentBalance + tokensToAdd

    const { data: updated } = await supabase
      .from("wallets")
      .update({
        balance_fantasy: newBalance,
        fantasy_total_accumulated: 10000,
      })
      .eq("user_id", effectiveUserId)
      .eq("fantasy_total_accumulated", Number(wallet.fantasy_total_accumulated))
      .select("user_id")

    if (!updated || updated.length === 0) {
      // Concurrent login already applied the top-up
      return NextResponse.json({ success: false, bonus: 0 })
    }

    if (tokensToAdd > 0) {
      await supabase.from("transactions").insert({
        user_id: effectiveUserId,
        token_type: "fantasy",
        amount: tokensToAdd,
        operation: "phase1_initial_balance",
      })

      return NextResponse.json({
        success: true,
        bonus: tokensToAdd,
        message: `¡Tus Fantasy Tokens fueron recargados a $10,000!`,
      })
    }

    return NextResponse.json({ success: false, bonus: 0 })
  } catch (error) {
    console.error("Login bonus error:", error)
    return NextResponse.json({ error: "Failed to process login bonus" }, { status: 500 })
  }
}
