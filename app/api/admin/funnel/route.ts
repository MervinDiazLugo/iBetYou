import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

const FUNNEL_STAGES = [
  "signup",
  "first_bet",
  "bet_streak_5",
  "low_balance_reached",
  "viewed_real_money_cta",
  "clicked_real_money_cta",
  "first_real_deposit",
]

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  const counts = await Promise.all(
    FUNNEL_STAGES.map(async (eventType) => {
      const { count } = await supabase
        .from("user_funnel_events")
        .select("user_id", { count: "exact", head: true })
        .eq("event_type", eventType)
      return { event: eventType, users: count ?? 0 }
    })
  )

  const signupCount = counts[0].users
  const stages = counts.map((c) => ({
    ...c,
    pct_of_signup: signupCount > 0 ? Math.round((c.users / signupCount) * 1000) / 10 : 0,
  }))

  return NextResponse.json({ stages })
}
