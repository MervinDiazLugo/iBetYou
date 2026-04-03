import { createAdminSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")

  if (code) {
    const supabase = createAdminSupabaseClient()
    
    // Exchange code for session
    const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!sessionError && sessionData.user) {
      const userId = sessionData.user.id
      const today = new Date().toISOString().split('T')[0]
      const bonusPerLogin = 50
      const maxDailyBonus = 500
      const maxAccumulated = 1000
      
      // Get wallet
      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance_fantasy, fantasy_total_accumulated")
        .eq("user_id", userId)
        .single()
      
      if (wallet) {
        const currentAccumulated = wallet?.fantasy_total_accumulated || 0
        const currentBalance = wallet?.balance_fantasy || 0
        
        // Check if first time (welcome bonus is outside daily limit)
        if (currentAccumulated === 0) {
          const welcomeBonus = 50
          await supabase
            .from("wallets")
            .update({
              balance_fantasy: currentBalance + welcomeBonus,
              fantasy_total_accumulated: welcomeBonus,
            })
            .eq("user_id", userId)
          
          await supabase.from("transactions").insert({
            user_id: userId,
            token_type: "fantasy",
            amount: welcomeBonus,
            operation: "welcome_bonus",
          })
          
          await supabase.from("daily_rewards").insert({
            user_id: userId,
            reward_amount: welcomeBonus,
          })
        } else {
          // Subsequent logins - check daily cap of $500
          const { data: todayBonuses } = await supabase
            .from("daily_rewards")
            .select("reward_amount")
            .eq("user_id", userId)
            .gte("rewarded_at", `${today}T00:00:00`)
            .lte("rewarded_at", `${today}T23:59:59`)
          
          const todayTotal = (todayBonuses || []).reduce((sum, b) => sum + (b.reward_amount || 0), 0)
          const remainingDaily = maxDailyBonus - todayTotal
          const remainingGlobal = maxAccumulated - currentAccumulated
          
          if (remainingDaily > 0 && remainingGlobal > 0) {
            // Calculate actual bonus
            const actualBonus = Math.min(bonusPerLogin, remainingDaily, remainingGlobal)
            
            await supabase
              .from("wallets")
              .update({
                balance_fantasy: currentBalance + actualBonus,
                fantasy_total_accumulated: currentAccumulated + actualBonus,
              })
              .eq("user_id", userId)
            
            await supabase.from("transactions").insert({
              user_id: userId,
              token_type: "fantasy",
              amount: actualBonus,
              operation: "login_bonus",
            })
            
            await supabase.from("daily_rewards").insert({
              user_id: userId,
              reward_amount: actualBonus,
            })
          }
        }
      }
    }
  }

  // Redirect to home
  return NextResponse.redirect(new URL("/", request.url))
}
