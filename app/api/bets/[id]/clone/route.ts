import { createAdminSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(request)
    if (!authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: betId } = await context.params
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("user_id")

    if (userId && userId !== authenticatedUserId) {
      return NextResponse.json({ error: "Unauthorized user scope" }, { status: 403 })
    }

    const effectiveUserId = authenticatedUserId

    if (!betId) {
      return NextResponse.json(
        { error: "Bet ID required" },
        { status: 400 }
      )
    }

    const supabase = createAdminSupabaseClient()

    if (effectiveUserId) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, is_banned, role, betting_blocked_until")
        .eq("id", effectiveUserId)
        .single()

      if (!profileError) {
        if (profile?.is_banned) {
          return NextResponse.json({ error: "User is banned from betting" }, { status: 403 })
        }

        if (profile?.role === "backoffice_admin") {
          return NextResponse.json({ error: "Los usuarios de backoffice no pueden clonar apuestas" }, { status: 403 })
        }

        if (profile?.betting_blocked_until) {
          const blockedUntil = new Date(profile.betting_blocked_until)
          if (blockedUntil > new Date()) {
            return NextResponse.json(
              {
                error: `No puedes apostar hasta ${blockedUntil.toLocaleString("es-ES")}`,
                blocked_until: profile.betting_blocked_until,
              },
              { status: 403 }
            )
          }
        }
      }
    }

    const { data: bet, error: betError } = await supabase
      .from("bets")
      .select("*, event:events(*)")
      .eq("id", betId)
      .single()

    if (betError || !bet) {
      return NextResponse.json(
        { error: "Bet not found" },
        { status: 404 }
      )
    }

    // Return only the data needed for cloning
    return NextResponse.json({
      success: true,
      bet: {
        event: {
          id: bet.event.id,
          sport: bet.event.sport,
          home_team: bet.event.home_team,
          away_team: bet.event.away_team,
          start_time: bet.event.start_time,
          league: bet.event.league,
          country: bet.event.country,
        },
        bet_type: bet.bet_type,
        amount: bet.amount,
        multiplier: bet.multiplier || 1,
        selection: bet.selection,
        creator_selection: bet.creator_selection,
      },
    })
  } catch (error) {
    console.error("Get clone bet error:", error)
    return NextResponse.json(
      { error: "Failed to fetch bet" },
      { status: 500 }
    )
  }
}
