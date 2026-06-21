import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  const [depositsRes, withdrawalsRes] = await Promise.all([
    supabase
      .from("ibeyc_deposits")
      .select("id, currency, amount_local, amount_ibyc, rate_to_usd, payment_method, status, created_at, confirmed_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("ibeyc_withdrawals")
      .select("id, currency, amount_ibyc_requested, fee_ibyc, amount_ibyc_net, amount_local, rate_to_usd, payment_method, status, created_at, processed_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ])

  return NextResponse.json({
    deposits: depositsRes.data ?? [],
    withdrawals: withdrawalsRes.data ?? [],
  })
}
