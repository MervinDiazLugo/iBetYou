import { createAdminSupabaseClient } from "@/lib/supabase"
import { applyReferral, getOrCreateReferralCode } from "@/lib/referrals"
import { logUserEvent } from "@/lib/funnel"
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

      // Funnel: log signup once per user (new signups have created_at within last 10 min)
      const isNewSignup = (Date.now() - new Date(sessionData.user.created_at).getTime()) < 10 * 60 * 1000
      if (isNewSignup) {
        await logUserEvent(userId, "signup", {
          provider: sessionData.user.app_metadata?.provider,
        }, supabase)

        // Apply referral code on new signup (independent of bonus logic)
        const refCode = request.cookies.get("iby_ref")?.value
        if (refCode) {
          await applyReferral(userId, refCode, supabase)
          response.cookies.delete("iby_ref")
        }
      }

      // Phase 1: one-time top-up to 10,000 tokens for existing users.
      // fantasy_total_accumulated >= 10000 means already initialized → no-op.
      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance_fantasy, fantasy_total_accumulated")
        .eq("user_id", userId)
        .single()

      if (wallet && Number(wallet.fantasy_total_accumulated) < 10000) {
        const currentBalance = Number(wallet.balance_fantasy)
        const tokensToAdd = Math.max(0, 10000 - currentBalance)
        const newBalance = currentBalance + tokensToAdd

        const { data: updated } = await supabase
          .from("wallets")
          .update({
            balance_fantasy: newBalance,
            fantasy_total_accumulated: 10000,
          })
          .eq("user_id", userId)
          .eq("fantasy_total_accumulated", Number(wallet.fantasy_total_accumulated))
          .select("user_id")

        if (updated && updated.length > 0 && tokensToAdd > 0) {
          await supabase.from("transactions").insert({
            user_id: userId,
            token_type: "fantasy",
            amount: tokensToAdd,
            operation: "phase1_initial_balance",
          })
        }
      }
    }
  }

  return response
}
