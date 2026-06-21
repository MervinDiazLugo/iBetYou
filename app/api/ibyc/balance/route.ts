import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()
  const { data: wallet } = await supabase
    .from("iby_wallets")
    .select("balance, balance_blocked")
    .eq("user_id", userId)
    .single()

  // Return available balance (total minus any blocked/reserved amount)
  const available = wallet
    ? Number(wallet.balance) - Number(wallet.balance_blocked ?? 0)
    : 0

  return NextResponse.json({ balance_ibyc: available })
}
