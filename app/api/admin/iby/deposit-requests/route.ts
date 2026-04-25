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
      id, user_id, transaction_id, amount, iby_coins, transaction_date,
      status, rejection_reason, created_at, reviewed_at,
      profile:profiles!user_id(id, nickname),
      deposit_account:deposit_accounts(type, label, details)
    `)
    .order("created_at", { ascending: false })
    .limit(200)

  if (status !== "all") {
    query = query.eq("status", status)
  }

  const { data: requests, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch emails from auth (same pattern as admin/bets route)
  const userIds = [...new Set((requests || []).map((r) => r.user_id).filter(Boolean))]
  let emailByUserId: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: usersRes } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    emailByUserId = (usersRes?.users || []).reduce((acc, u) => {
      if (u.id && u.email && userIds.includes(u.id)) acc[u.id] = u.email
      return acc
    }, {} as Record<string, string>)
  }

  const enriched = (requests || []).map((r) => ({
    ...r,
    profile: r.profile
      ? { ...(Array.isArray(r.profile) ? r.profile[0] : r.profile), email: emailByUserId[r.user_id] || null }
      : { id: r.user_id, nickname: null, email: emailByUserId[r.user_id] || null },
  }))

  return NextResponse.json({ requests: enriched })
}
