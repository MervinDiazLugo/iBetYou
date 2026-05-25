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

export async function canCountryUseHouseBetting(
  country: string | null,
  mode: "fantasy" | "real"
): Promise<boolean> {
  if (!country) return false
  const supabase = createAdminSupabaseClient()
  const field = mode === "real" ? "house_betting_real_enabled" : "house_betting_fantasy_enabled"
  const { data } = await supabase
    .from("country_configs")
    .select(field)
    .eq("country_code", country)
    .single()
  return (data as any)?.[field] === true
}

export async function canCountryUseGroups(country: string | null): Promise<boolean> {
  if (!country) return false
  const supabase = createAdminSupabaseClient()
  const { data } = await supabase
    .from("country_configs")
    .select("groups_enabled")
    .eq("country_code", country)
    .single()
  return data?.groups_enabled === true
}
