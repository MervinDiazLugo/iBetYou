import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

const CLEANUP_SECRET = process.env.CRON_SECRET

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CLEANUP_SECRET || authHeader !== `Bearer ${CLEANUP_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()

  // Get event IDs with active bets (must not delete these)
  const { data: activeBets } = await supabase
    .from("bets")
    .select("event_id")
    .in("status", ["open", "taken", "pending_resolution", "disputed"])

  const protectedIds = [...new Set((activeBets || []).map(b => b.event_id))]

  // Find football scheduled events without predictions
  let query = supabase
    .from("events")
    .select("id")
    .eq("sport", "football")
    .eq("status", "scheduled")
    .is("metadata->predictions", null)

  if (protectedIds.length > 0) {
    query = query.not("id", "in", `(${protectedIds.join(",")})`)
  }

  const { data: toDelete, error: findErr } = await query

  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })
  if (!toDelete?.length) return NextResponse.json({ deleted: 0 })

  const ids = toDelete.map(e => e.id)

  const { error: delErr } = await supabase
    .from("events")
    .delete()
    .in("id", ids)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ deleted: ids.length, protected: protectedIds.length })
}
