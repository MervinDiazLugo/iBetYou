import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import {
  calcDirectOdds,
  calcExactScoreOdds,
  calcScoreMarginOdds,
  calcRunLineOdds,
  calcTotalRunsOdds,
} from "@/lib/house-odds"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const eventId = Number(searchParams.get("eventId"))
  const betType = searchParams.get("betType")
  const selection = searchParams.get("selection") ?? ""

  if (!eventId || !betType) {
    return NextResponse.json({ error: "eventId and betType are required" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()
  const { data: event, error } = await supabase
    .from("events")
    .select("sport, metadata, featured, status")
    .eq("id", eventId)
    .single()

  if (error || !event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 })
  }
  if (!event.featured) {
    return NextResponse.json({ error: "Not a featured event" }, { status: 400 })
  }
  if (event.status === "finished" || event.status === "cancelled") {
    return NextResponse.json({ error: "Event not available" }, { status: 400 })
  }

  if (betType === "direct") {
    const percent = (event.metadata as any)?.predictions?.percent
    if (!percent) return NextResponse.json({ error: "No predictions available" }, { status: 400 })
    const odds = calcDirectOdds(percent)
    if (!odds) return NextResponse.json({ error: "Cannot compute odds" }, { status: 400 })
    return NextResponse.json({ betType: "direct", odds })
  }

  if (betType === "exact_score") {
    if (!selection || !/^\d+\s*[-:]\s*\d+$/.test(selection)) {
      return NextResponse.json({ error: "Invalid score format" }, { status: 400 })
    }
    const odds = calcExactScoreOdds(event.sport, selection, event.metadata as any)
    if (odds === null) return NextResponse.json({ error: "Exact score not available for this sport" }, { status: 400 })
    return NextResponse.json({ betType: "exact_score", selection, odds })
  }

  if (betType === "score_margin") {
    if (!selection) return NextResponse.json({ error: "selection required" }, { status: 400 })
    const odds = calcScoreMarginOdds(selection)
    if (odds === null) return NextResponse.json({ error: "Invalid selection" }, { status: 400 })
    return NextResponse.json({ betType: "score_margin", selection, odds })
  }

  if (betType === "run_line") {
    if (!selection) return NextResponse.json({ error: "selection required" }, { status: 400 })
    const odds = calcRunLineOdds(selection)
    if (odds === null) return NextResponse.json({ error: "Invalid selection" }, { status: 400 })
    return NextResponse.json({ betType: "run_line", selection, odds })
  }

  if (betType === "total_runs") {
    if (!selection) return NextResponse.json({ error: "selection required" }, { status: 400 })
    const odds = calcTotalRunsOdds(selection)
    if (odds === null) return NextResponse.json({ error: "Invalid selection" }, { status: 400 })
    return NextResponse.json({ betType: "total_runs", selection, odds })
  }

  return NextResponse.json({ error: "Unknown betType" }, { status: 400 })
}
