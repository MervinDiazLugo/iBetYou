import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const supabase = createAdminSupabaseClient()

  const userId = await getAuthenticatedUserId(request)

  let userCountry: string | null = null
  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("country")
      .eq("id", userId)
      .single()
    userCountry = profile?.country ?? null
  }

  const { data: accounts, error } = await supabase
    .from("deposit_accounts")
    .select("id, type, label, details, country")
    .eq("is_active", true)
    .order("type")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const filtered = (accounts || []).filter((acc) => {
    if (acc.type === "binance" || acc.country === null || acc.country === undefined) return true
    if (!userCountry) return false
    return acc.country === userCountry
  })

  return NextResponse.json({ accounts: filtered })
}
