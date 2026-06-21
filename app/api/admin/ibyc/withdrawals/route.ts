import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const currency = searchParams.get("currency")
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 200)

  const supabase = createAdminSupabaseClient()

  let query = supabase
    .from("ibeyc_withdrawals")
    .select(`
      id, currency, amount_ibyc_requested, fee_ibyc, amount_ibyc_net, amount_local,
      rate_to_usd, rate_source, payment_method, payment_details, contact_whatsapp,
      status, rejection_reason, admin_notes, created_at, processed_at,
      user:profiles!ibeyc_withdrawals_user_id_fkey(id, nickname, email, phone_whatsapp)
    `)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (status) query = query.eq("status", status)
  if (currency) query = query.eq("currency", currency)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ withdrawals: data ?? [] })
}
