import { createAdminSupabaseClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

// Public endpoint — returns platform limits visible to all users
export async function GET() {
  const supabase = createAdminSupabaseClient()
  const { data } = await supabase
    .from("iby_settings")
    .select("key, value")
    .in("key", ["max_bet_amount", "max_bet_amount_house"])

  const settings: Record<string, number | null> = {
    max_bet_amount: null,
    max_bet_amount_house: null,
  }

  for (const row of data || []) {
    const val = Number(row.value)
    if (Number.isFinite(val) && val > 0) settings[row.key] = val
  }

  return NextResponse.json(settings)
}
