import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"

const LATAM_ORDER = [
  "Venezuela", "Colombia", "Argentina", "Mexico", "Chile", "Peru",
  "Ecuador", "Bolivia", "Uruguay", "Paraguay", "Brazil", "Spain", "United States",
]

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const eventId = Number(id)
  if (!Number.isFinite(eventId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const supabase = createAdminSupabaseClient()
  const { data: event, error } = await supabase.from("events").select("*").eq("id", eventId).single()
  if (error || !event) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { data: openBets } = await supabase
    .from("bets")
    .select("id, bet_type, creator_selection, amount, status, creator_id")
    .eq("event_id", eventId)
    .eq("status", "open")

  // Prioritize TV channels for the LATAM audience
  const channels = ((event.metadata?.tv?.channels as any[]) || []).slice().sort((a, b) => {
    const ia = LATAM_ORDER.indexOf(a.country)
    const ib = LATAM_ORDER.indexOf(b.country)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })

  return NextResponse.json({
    event: {
      ...event,
      metadata: { ...event.metadata, tv: { ...(event.metadata?.tv || {}), channels } },
    },
    openBets: openBets || [],
  })
}
