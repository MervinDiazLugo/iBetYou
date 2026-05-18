import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  const { data: wallet, error } = await supabase
    .from("iby_wallets")
    .select("balance, balance_blocked, referral_bonus_locked, updated_at")
    .eq("user_id", userId)
    .single()

  if (error || !wallet) {
    const { data: created } = await supabase
      .from("iby_wallets")
      .insert({ user_id: userId })
      .select("balance, balance_blocked, referral_bonus_locked, updated_at")
      .single()
    return NextResponse.json({
      wallet: created || { balance: 0, balance_blocked: 0, referral_bonus_locked: 0 },
    })
  }

  return NextResponse.json({ wallet })
}
