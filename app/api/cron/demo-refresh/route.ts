import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

const CRON_SECRET = process.env.CRON_SECRET

// Generate synthetic score weighted by prediction probability
function syntheticScore(sport: string, homeProb: number): { home: number; away: number } {
  const r = Math.random()
  const homeWins = r < homeProb
  const draw = !homeWins && r < homeProb + (sport === "football" ? 0.25 : 0)

  if (sport === "football") {
    if (homeWins) {
      const home = Math.floor(Math.random() * 3) + 1  // 1-3
      const away = Math.floor(Math.random() * home)    // 0 to home-1
      return { home, away }
    } else if (draw) {
      const goals = Math.floor(Math.random() * 3)      // 0-2
      return { home: goals, away: goals }
    } else {
      const away = Math.floor(Math.random() * 3) + 1
      const home = Math.floor(Math.random() * away)
      return { home, away }
    }
  } else if (sport === "basketball") {
    const base = 85 + Math.floor(Math.random() * 25)   // 85-109
    const diff = 3 + Math.floor(Math.random() * 18)    // 3-20 pt diff
    return homeWins ? { home: base + diff, away: base } : { home: base, away: base + diff }
  } else {
    // baseball
    const base = 2 + Math.floor(Math.random() * 5)     // 2-6
    const diff = 1 + Math.floor(Math.random() * 4)     // 1-4
    return homeWins ? { home: base + diff, away: base } : { home: base, away: base + diff }
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()

  // Check demo mode active
  const { data: demoSetting } = await supabase.from("app_settings").select("value").eq("key", "demo_mode").maybeSingle()
  if ((demoSetting?.value as any)?.active !== true) {
    return NextResponse.json({ success: true, message: "Demo mode not active — nothing to do" })
  }

  // Fetch all demo events
  const { data: demoEvents } = await supabase
    .from("events")
    .select("id, sport, status, home_score, away_score, metadata")
    .eq("is_demo", true)

  if (!demoEvents?.length) {
    return NextResponse.json({ success: true, message: "No demo events found" })
  }

  const resolved: number[] = []
  const failed: string[] = []

  // For each demo event: generate synthetic score if finished or scheduled (force finish)
  for (const ev of demoEvents) {
    const pred = (ev.metadata as any)?.predictions
    const homeProb = pred?.percent?.home
      ? parseFloat(String(pred.percent.home).replace("%", "")) / 100
      : 0.5

    // Generate synthetic score
    const score = syntheticScore(ev.sport, homeProb)

    // Update event: mark finished with synthetic score
    const { error: updateErr } = await supabase
      .from("events")
      .update({ status: "finished", home_score: score.home, away_score: score.away })
      .eq("id", ev.id)

    if (updateErr) { failed.push(`event ${ev.id}: ${updateErr.message}`); continue }
    resolved.push(ev.id)
  }

  // Trigger auto-resolve for all demo events that now have scores — parallel to stay within cron timeout
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}` || "http://localhost:3000"
  const autoResolveResults = await Promise.all(resolved.map(async (eventId) => {
    try {
      const res = await fetch(`${baseUrl}/api/admin/bets/auto-resolve-finished`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auto-resolve-secret": CRON_SECRET },
        body: JSON.stringify({ event_id: eventId }),
      })
      const data = await res.json()
      return { event_id: eventId, ...data }
    } catch (e: any) {
      failed.push(`auto-resolve event ${eventId}: ${e.message}`)
      return { event_id: eventId, error: (e as Error).message }
    }
  }))

  // Clear old demo events + bets, then trigger new demo activation
  await supabase.from("events").update({ is_demo: false }).eq("is_demo", true)
  await supabase.from("bets").update({ status: "cancelled" }).eq("is_demo", true).eq("status", "open")

  // Re-activate demo with fresh events
  let reactivated = false
  try {
    const activateRes = await fetch(`${baseUrl}/api/admin/demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-auto-resolve-secret": CRON_SECRET },
    })
    if (!activateRes.ok) throw new Error(`HTTP ${activateRes.status}`)
    const activateData = await activateRes.json()
    console.log("[cron/demo-refresh] new demo activated:", activateData)
    reactivated = true
  } catch (e: any) {
    console.error("[cron/demo-refresh] re-activate failed:", e.message)
    failed.push(`demo re-activate: ${e.message}`)
    // Do NOT set active=false — leave demo_mode as-is. The backoffice can manually re-activate.
    // Setting active=false here caused daily "no events" issues when this call timed out.
  }

  console.log("[cron/demo-refresh]", { resolved: resolved.length, failed })

  return NextResponse.json({
    success: true,
    demo_events_resolved: resolved.length,
    auto_resolve_results: autoResolveResults,
    failed,
  })
}
