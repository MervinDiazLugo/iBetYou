import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { logUserEvent } from "@/lib/funnel"

const ALLOWED_EVENTS = ["viewed_real_money_cta", "clicked_real_money_cta", "clicked_referral_cta"]

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { eventType, metadata } = body

  if (!ALLOWED_EVENTS.includes(eventType)) {
    return NextResponse.json({ error: "Evento no permitido" }, { status: 400 })
  }

  await logUserEvent(userId, eventType, metadata)
  return NextResponse.json({ success: true })
}
