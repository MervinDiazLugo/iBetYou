import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import {
  TSDB_LEAGUES,
  tsdbScheduleNext,
  normalizeTsdbEvent,
} from "@/lib/tsdb"

const CRON_SECRET = process.env.CRON_SECRET
const BATCH_SIZE = 500

// Only import events starting within the next 7 days (UTC)
function isWithinNext7Days(timestamp: string): boolean {
  const t = new Date(timestamp).getTime()
  const now = Date.now()
  return t >= now - 60 * 60 * 1000 && t <= now + 7 * 24 * 60 * 60 * 1000
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.THESPORTSDB_API_KEY) {
    return NextResponse.json({ error: "THESPORTSDB_API_KEY not configured" }, { status: 500 })
  }

  const supabase = createAdminSupabaseClient()
  const allEvents: Record<string, unknown>[] = []
  const leagueErrors: string[] = []

  // Fetch next upcoming events for each league (1 API call per league)
  for (const league of TSDB_LEAGUES) {
    try {
      const events = await tsdbScheduleNext(league.id)

      for (const raw of events) {
        if (!raw.strTimestamp) continue
        if (!isWithinNext7Days(`${raw.strTimestamp}Z`)) continue

        const normalized = normalizeTsdbEvent(raw, league.sport)
        if (normalized) allEvents.push(normalized)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown"
      leagueErrors.push(`league ${league.id}: ${msg}`)
    }
  }

  if (allEvents.length === 0) {
    return NextResponse.json({
      success: true,
      totalInserted: 0,
      leagueErrors,
      message: "No upcoming events in next 7 days",
    })
  }

  // Deduplicate against existing events
  const externalIds = allEvents.map((e) => e.external_id as string)
  const { data: existing } = await supabase
    .from("events")
    .select("external_id")
    .in("external_id", externalIds)

  const existingSet = new Set((existing || []).map((e: any) => e.external_id as string))
  const toInsert = allEvents.filter((e) => !existingSet.has(e.external_id as string))

  let totalInserted = 0
  const insertErrors: string[] = []

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE)
    const { data: inserted, error } = await supabase
      .from("events")
      .upsert(batch, { onConflict: "external_id", ignoreDuplicates: true })
      .select("id, external_id")

    if (error) {
      insertErrors.push(`batch ${i}: ${error.message}`)
    } else {
      totalInserted += (inserted || []).length
    }
  }

  console.log("[cron/sync-events]", {
    fetched: allEvents.length,
    skipped: allEvents.length - toInsert.length,
    totalInserted,
    leagueErrors,
    insertErrors,
  })

  return NextResponse.json({
    success: true,
    fetched: allEvents.length,
    skipped: allEvents.length - toInsert.length,
    totalInserted,
    errors: [...leagueErrors, ...insertErrors],
  })
}
