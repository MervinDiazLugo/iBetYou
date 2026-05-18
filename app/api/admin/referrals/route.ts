import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  const { count: totalReferrals } = await supabase
    .from("referral_bonuses")
    .select("*", { count: "exact", head: true })

  const { data: statusCounts } = await supabase
    .from("referral_bonuses")
    .select("status")

  const locked = statusCounts?.filter((r) => r.status === "locked").length ?? 0
  const unlocked = statusCounts?.filter((r) => r.status === "unlocked").length ?? 0

  const { data: walletSums } = await supabase
    .from("wallets")
    .select("referral_bonus_locked")

  const totalLocked =
    walletSums?.reduce((sum, w) => sum + (Number(w.referral_bonus_locked) || 0), 0) ?? 0

  const { data: topReferrers } = await supabase
    .from("profiles")
    .select("id, nickname, referral_count")
    .gt("referral_count", 0)
    .order("referral_count", { ascending: false })
    .limit(10)

  return NextResponse.json({
    total_referral_bonuses: totalReferrals ?? 0,
    bonuses_locked: locked,
    bonuses_unlocked: unlocked,
    total_locked_tokens: totalLocked,
    top_referrers: topReferrers ?? [],
  })
}
