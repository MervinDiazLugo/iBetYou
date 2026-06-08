import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

export const revalidate = 60

export async function GET() {
  const supabase = createAdminSupabaseClient()
  const { data } = await supabase.from("app_settings").select("value").eq("key", "demo_mode").maybeSingle()
  const active = (data?.value as any)?.active === true
  const res = NextResponse.json({ active })
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120")
  return res
}
