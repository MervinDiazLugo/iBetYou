import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"
import { cleanupExpiredOpenBets } from "@/lib/open-bets-cleanup"

function hasValidCleanupSecret(request: NextRequest) {
  const expected = process.env.CLEANUP_API_SECRET || process.env.CRON_SECRET
  if (!expected) return false

  const byHeader = request.headers.get("x-cleanup-secret")
  if (byHeader && byHeader === expected) return true

  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (token === expected) return true
  }

  return false
}

export async function POST(request: NextRequest) {
  const authorizedBySecret = hasValidCleanupSecret(request)

  if (!authorizedBySecret) {
    const auth = await requireBackofficeAdmin(request)
    if (!auth.authorized) {
      return auth.response
    }
  }

  const supabase = createAdminSupabaseClient()

  try {
    const result = await cleanupExpiredOpenBets(supabase, "system")
    return NextResponse.json({
      success: true,
      message: "Open bets cleanup completed",
      ...result,
    })
  } catch (error: any) {
    console.error("Cleanup open bets error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
