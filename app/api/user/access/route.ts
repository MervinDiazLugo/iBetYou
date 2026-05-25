import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { canCountryUseRealMoney, canCountryUseGroups } from "@/lib/country-access"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ canUseRealMoney: false, canUseGroups: true, country: null })

  const supabase = createAdminSupabaseClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("country")
    .eq("id", userId)
    .single()

  const country = profile?.country ?? null
  const [canUseRealMoney, canUseGroups] = await Promise.all([
    canCountryUseRealMoney(country),
    canCountryUseGroups(country),
  ])

  return NextResponse.json({ canUseRealMoney, canUseGroups, country })
}
