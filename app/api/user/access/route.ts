import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { canCountryUseRealMoney } from "@/lib/country-access"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ canUseRealMoney: false, country: null })

  const supabase = createAdminSupabaseClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("country")
    .eq("id", userId)
    .single()

  const country = profile?.country ?? null
  const canUseRealMoney = await canCountryUseRealMoney(country)

  return NextResponse.json({ canUseRealMoney, country })
}
