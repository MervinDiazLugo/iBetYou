import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { tsdbLivescoreSoccer, tsdbLivescoreBasketball, tsdbLivescoreBaseball, mapTsdbStatus } from "@/lib/tsdb"
import { getLiveProbability, type LiveState } from "@/lib/live-probability"

const CRON_SECRET = process.env.CRON_SECRET

function toScore(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const supabase = createAdminSupabaseClient()

  // ── Gate: live events that matter ──
  const { data: liveEvents } = await supabase
    .from("events")
    .select("id, external_id, sport, status, featured, metadata")
    .eq("status", "live")
  if (!liveEvents?.length) return NextResponse.json({ skipped: true, reason: "no live events" })

  const ids = liveEvents.map((e) => e.id)
  const { data: activeBets } = await supabase
    .from("bets").select("event_id").in("event_id", ids).in("status", ["open", "taken", "disputed"])
  const withBets = new Set((activeBets || []).map((b) => b.event_id))
  const targets = liveEvents.filter((e) => withBets.has(e.id) || e.featured)
  if (!targets.length) return NextResponse.json({ skipped: true, reason: "no bets/featured" })

  // ── Fetch livescores (by sport present among targets) ──
  const sports = new Set(targets.map((e) => e.sport))
  const liveMap = new Map<string, any>()
  const calls: Promise<any[]>[] = []
  if (sports.has("football")) calls.push(tsdbLivescoreSoccer().catch(() => []))
  if (sports.has("basketball")) calls.push(tsdbLivescoreBasketball().catch(() => []))
  if (sports.has("baseball")) calls.push(tsdbLivescoreBaseball().catch(() => []))
  for (const arr of await Promise.all(calls)) {
    for (const it of arr) liveMap.set(`tsdb_${it.idEvent}`, it)
  }

  const now = Date.now()
  let updated = 0
  let settledTotal = 0
  await Promise.all(
    targets.map(async (ev) => {
      const item = liveMap.get(ev.external_id)
      if (!item) return
      const home = toScore(item.intHomeScore) ?? 0
      const away = toScore(item.intAwayScore) ?? 0
      const md = ev.metadata || {}
      const prevLive = md.live || {}
      const prevSnaps: any[] = Array.isArray(prevLive.snapshots) ? prevLive.snapshots : []
      const scoreChanged = prevLive.home_score !== home || prevLive.away_score !== away
      const snapshots = scoreChanged
        ? [...prevSnaps, { t: new Date(now).toISOString(), minute: Number(item.strProgress) || item.strProgress, home, away }].slice(-30)
        : prevSnaps

      const liveState: LiveState = {
        home_score: home,
        away_score: away,
        progress: String(item.strProgress ?? ""),
        status: (item.strStatus || "").toUpperCase(),
      }
      const prior = {
        homeGoalsAvg: Number(md.predictions?.home_goals_avg) || undefined,
        awayGoalsAvg: Number(md.predictions?.away_goals_avg) || undefined,
      }
      const win_prob = getLiveProbability(ev.sport, liveState, prior)

      const mapped = mapTsdbStatus(item.strStatus)
      const live = {
        status: mapped === "live" ? (item.strStatus || "").toUpperCase() : mapped,
        progress: String(item.strProgress ?? ""),
        home_score: home,
        away_score: away,
        updated_at: new Date(now).toISOString(),
        snapshots,
        win_prob,
        suspended: scoreChanged, // freeze one cycle after a score change
        suspend_reason: scoreChanged ? "score_changed" : null,
      }

      await supabase.from("events").update({
        home_score: home,
        away_score: away,
        metadata: { ...md, live },
      }).eq("id", ev.id)
      updated++

      // Settle any P2P-live bets that can resolve mid-match from the new score
      const { settleLiveBetsForEvent } = await import("@/lib/settle-live-bets")
      settledTotal += await settleLiveBetsForEvent(supabase, ev.id, { home, away }, false)
    })
  )

  return NextResponse.json({ success: true, targets: targets.length, updated, settled: settledTotal })
}
