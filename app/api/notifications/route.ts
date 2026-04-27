import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id, type, title, body, bet_id, read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ notifications: notifications || [] })
}

export async function PATCH(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const supabase = createAdminSupabaseClient()

  if (body.all) {
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false)
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .in("id", body.ids)
  }

  return NextResponse.json({ success: true })
}
