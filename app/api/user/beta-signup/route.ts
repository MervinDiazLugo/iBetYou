import { createAdminSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedUserId } from "@/lib/server-auth"

const BETA_BONUS = 2000

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  // Check if already joined
  const { count } = await supabase
    .from("user_funnel_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_type", "beta_waitlist_join")

  if ((count ?? 0) > 0) {
    return NextResponse.json({ success: false, already_joined: true })
  }

  // Record waitlist join
  await supabase.from("user_funnel_events").insert({
    user_id: userId,
    event_type: "beta_waitlist_join",
    metadata: { source: "low_balance_banner" },
  })

  // Credit bonus tokens
  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance_fantasy")
    .eq("user_id", userId)
    .single()

  if (wallet) {
    await supabase.from("wallets")
      .update({ balance_fantasy: Number(wallet.balance_fantasy) + BETA_BONUS })
      .eq("user_id", userId)

    await supabase.from("transactions").insert({
      user_id: userId,
      token_type: "fantasy",
      amount: BETA_BONUS,
      operation: "beta_signup_bonus",
    })
  }

  return NextResponse.json({ success: true, bonus: BETA_BONUS })
}
