import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status") || "pending"

  let query = supabase
    .from("deposit_requests")
    .select(`
      id, transaction_id, amount, iby_coins, transaction_date,
      status, rejection_reason, created_at, reviewed_at,
      profile:profiles(id, nickname, email),
      deposit_account:deposit_accounts(type, label, details)
    `)
    .order("created_at", { ascending: false })
    .limit(200)

  if (status !== "all") {
    query = query.eq("status", status)
  }

  const { data: requests, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ requests: requests || [] })
}
