import { createAdminSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(request)
    if (!authenticatedUserId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { userId } = await request.json()

    if (userId && userId !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Unauthorized user scope" },
        { status: 403 }
      )
    }

    const effectiveUserId = authenticatedUserId

    const supabase = createAdminSupabaseClient()

    // Admins never receive tokens
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", effectiveUserId)
      .single()

    if (profile?.role === "backoffice_admin") {
      await supabase
        .from("wallets")
        .update({ balance_fantasy: 0, balance_real: 0, fantasy_total_accumulated: 0 })
        .eq("user_id", effectiveUserId)
      return NextResponse.json({ success: false, bonus: 0, message: "Admins no reciben tokens" })
    }
    const today = new Date().toISOString().split('T')[0]
    const bonusPerLogin = 50
    const maxDailyBonus = 500
    const maxAccumulated = 1000

    // Get wallet info
    const { data: wallet, error: walletError } = await supabase
      .from("wallets")
      .select("id, balance_fantasy, fantasy_total_accumulated")
      .eq("user_id", effectiveUserId)
      .single()

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: "Wallet not found" },
        { status: 404 }
      )
    }

    // Check if user already has a wallet (not first time signup)
    if (wallet.fantasy_total_accumulated === undefined || wallet.fantasy_total_accumulated === 0) {
      // First time - give welcome bonus outside of daily limit
      const welcomeBonus = 50
      
      await supabase
        .from("wallets")
        .update({
          balance_fantasy: wallet.balance_fantasy + welcomeBonus,
          fantasy_total_accumulated: welcomeBonus,
        })
        .eq("user_id", effectiveUserId)

      await supabase.from("transactions").insert({
        user_id: effectiveUserId,
        token_type: "fantasy",
        amount: welcomeBonus,
        operation: "welcome_bonus",
      })

      await supabase.from("daily_rewards").insert({
        user_id: effectiveUserId,
        reward_amount: welcomeBonus,
      })

      return NextResponse.json({
        success: true,
        bonus: welcomeBonus,
        message: `¡Bienvenido! Se acreditaron $${welcomeBonus} en Fantasy Tokens`,
      })
    }

    // Subsequent logins - check daily cap of $500
    const { data: todayBonuses, error: bonusError } = await supabase
      .from("daily_rewards")
      .select("reward_amount")
      .eq("user_id", effectiveUserId)
      .gte("rewarded_at", `${today}T00:00:00`)
      .lte("rewarded_at", `${today}T23:59:59`)

    const todayTotal = (todayBonuses || []).reduce((sum, b) => sum + (b.reward_amount || 0), 0)
    const remainingDaily = maxDailyBonus - todayTotal
    const currentAccumulated = wallet.fantasy_total_accumulated || 0
    const remainingGlobal = maxAccumulated - currentAccumulated

    if (remainingDaily <= 0) {
      return NextResponse.json({
        success: false,
        bonus: 0,
        message: "Ya has alcanzado el límite diario de $500",
        remaining: 0,
      })
    }

    if (remainingGlobal <= 0) {
      return NextResponse.json({
        success: false,
        bonus: 0,
        message: "Ya has alcanzado el límite acumulado de $1000",
        remaining: 0,
      })
    }

    // Calculate actual bonus (min of: per-login, remaining daily, remaining global)
    const actualBonus = Math.min(bonusPerLogin, remainingDaily, remainingGlobal)

    // Update wallet
    await supabase
      .from("wallets")
      .update({
        balance_fantasy: wallet.balance_fantasy + actualBonus,
        fantasy_total_accumulated: currentAccumulated + actualBonus,
      })
      .eq("user_id", effectiveUserId)

    // Record transaction
    await supabase.from("transactions").insert({
      user_id: effectiveUserId,
      token_type: "fantasy",
      amount: actualBonus,
      operation: "login_bonus",
    })

    // Record daily reward
    await supabase.from("daily_rewards").insert({
      user_id: effectiveUserId,
      reward_amount: actualBonus,
    })

    const newDailyTotal = todayTotal + actualBonus
    const remainingAfter = maxDailyBonus - newDailyTotal

    return NextResponse.json({
      success: true,
      bonus: actualBonus,
      message: `+$${actualBonus} Fantasy Tokens acreditados! Límite diario: $${remainingAfter} restantes`,
      remaining: remainingAfter,
    })
  } catch (error) {
    console.error("Login bonus error:", error)
    return NextResponse.json(
      { error: "Failed to process login bonus" },
      { status: 500 }
    )
  }
}
