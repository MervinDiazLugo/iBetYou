import { createAdminSupabaseClient } from "@/lib/supabase"

export async function canCountryUseRealMoney(country: string | null): Promise<boolean> {
  if (!country) return false
  const supabase = createAdminSupabaseClient()
  const { data } = await supabase
    .from("country_configs")
    .select("real_money_enabled")
    .eq("country_code", country)
    .single()
  return data?.real_money_enabled === true
}
