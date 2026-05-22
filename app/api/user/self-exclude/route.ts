import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  // Ban at auth level — prevents all logins for 72h
  const { error: banError } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "72h",
  })
  if (banError) return NextResponse.json({ error: banError.message }, { status: 500 })

  // Invalidate all active sessions immediately
  await supabase.auth.admin.signOut(userId, "global")

  // Record in profiles so betting is also blocked if the session somehow survives
  const blockedUntil = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
  await supabase.from("profiles").update({ betting_blocked_until: blockedUntil }).eq("id", userId)

  return NextResponse.json({ success: true, blocked_until: blockedUntil })
}
