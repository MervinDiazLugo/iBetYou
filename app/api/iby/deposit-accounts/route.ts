import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

export async function GET() {
  const supabase = createAdminSupabaseClient()

  const { data: accounts, error } = await supabase
    .from("deposit_accounts")
    .select("id, type, label, details")
    .eq("is_active", true)
    .order("type")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ accounts: accounts || [] })
}
