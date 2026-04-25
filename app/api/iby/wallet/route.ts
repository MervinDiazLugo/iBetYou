import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  const { data: wallet, error } = await supabase
    .from("iby_wallets")
    .select("balance, updated_at")
    .eq("user_id", userId)
    .single()

  if (error || !wallet) {
    // Auto-create wallet if missing
    const { data: created } = await supabase
      .from("iby_wallets")
      .insert({ user_id: userId })
      .select("balance, updated_at")
      .single()
    return NextResponse.json({ wallet: created || { balance: 0 } })
  }

  return NextResponse.json({ wallet })
}
