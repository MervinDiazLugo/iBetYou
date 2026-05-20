import { createAdminSupabaseClient } from "@/lib/supabase"
import { applyReferral, getOrCreateReferralCode } from "@/lib/referrals"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const response = NextResponse.redirect(new URL("/", request.url))

  if (code) {
    const supabase = createAdminSupabaseClient()

    const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

    if (!sessionError && sessionData.user) {
      const userId = sessionData.user.id
      const userMeta = sessionData.user.user_metadata || {}

      // Apply nickname/country from registration metadata if present
      if (userMeta.nickname) {
        const profileUpdate: Record<string, unknown> = { nickname: userMeta.nickname }
        if (userMeta.country) profileUpdate.country = userMeta.country
        await supabase.from("profiles").update(profileUpdate).eq("id", userId)
      }

      // Check if admin — admins get no tokens and go to backoffice
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single()

      if (profile?.role === "backoffice_admin") {
        await supabase
          .from("wallets")
          .update({ balance_fantasy: 0, balance_real: 0, fantasy_total_accumulated: 0 })
          .eq("user_id", userId)
        // Note: intentionally returns a fresh redirect (not `response`) since no cookies
        // need to be set on the admin path. Keep getOrCreateReferralCode AFTER this branch.
        return NextResponse.redirect(new URL("/backoffice", request.url))
      }

      // Non-critical: ensure user has a referral code. Swallow errors to never break login.
      try { await getOrCreateReferralCode(userId, supabase) } catch {}

      const today = new Date().toISOString().split("T")[0]
      const bonusPerLogin = 50
      const maxDailyBonus = 500
      const maxAccumulated = 1000

      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance_fantasy, fantasy_total_accumulated")
        .eq("user_id", userId)
        .single()

      if (wallet) {
        const currentAccumulated = wallet?.fantasy_total_accumulated || 0
        const currentBalance = wallet?.balance_fantasy || 0

        if (currentAccumulated === 0) {
          // First time: welcome bonus
          await supabase
            .from("wallets")
            .update({
              balance_fantasy: currentBalance + bonusPerLogin,
              fantasy_total_accumulated: bonusPerLogin,
            })
            .eq("user_id", userId)

          await supabase.from("transactions").insert({
            user_id: userId,
            token_type: "fantasy",
            amount: bonusPerLogin,
            operation: "welcome_bonus",
          })

          await supabase.from("daily_rewards").insert({
            user_id: userId,
            reward_amount: bonusPerLogin,
          })

          // Process referral code if present (only on first login = new registration)
          const refCode = request.cookies.get("iby_ref")?.value
          if (refCode) {
            await applyReferral(userId, refCode, supabase)
            response.cookies.delete("iby_ref")
          }
        } else {
          // Subsequent logins: daily login bonus
          const { data: todayBonuses } = await supabase
            .from("daily_rewards")
            .select("reward_amount")
            .eq("user_id", userId)
            .gte("rewarded_at", `${today}T00:00:00`)
            .lte("rewarded_at", `${today}T23:59:59`)

          const todayTotal = (todayBonuses || []).reduce(
            (sum, b) => sum + (b.reward_amount || 0),
            0
          )
          const remainingDaily = maxDailyBonus - todayTotal
          const remainingGlobal = maxAccumulated - currentAccumulated

          if (remainingDaily > 0 && remainingGlobal > 0) {
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

  return response
}
