import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()
  const { data: wallet, error } = await supabase
    .from("wallets")
    .select("balance_real")
    .eq("user_id", userId)
    .single()

  if (error || !wallet) return NextResponse.json({ error: "Wallet no encontrada" }, { status: 404 })

  return NextResponse.json({ balance_ibyc: wallet.balance_real })
}
