import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  const { count: locked } = await supabase
    .from("referral_bonuses")
    .select("*", { count: "exact", head: true })
    .eq("status", "locked")

  const { count: unlocked } = await supabase
    .from("referral_bonuses")
    .select("*", { count: "exact", head: true })
    .eq("status", "unlocked")

  // TODO: push this aggregation to a DB-level SUM() once wallet counts grow large
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
    total_referral_bonuses: (locked ?? 0) + (unlocked ?? 0),
    bonuses_locked: locked,
    bonuses_unlocked: unlocked,
    total_locked_tokens: totalLocked,
    top_referrers: topReferrers ?? [],
  })
}
