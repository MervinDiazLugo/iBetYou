import { createAdminSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedUserId, requireBackofficeAdmin } from "@/lib/server-auth"

const ALLOWED_COUNTRIES = [
  "Venezuela","Argentina","Colombia","Chile","México","Perú","Uruguay",
  "Bolivia","Ecuador","Paraguay","Brasil","Costa Rica","Panamá","Honduras",
  "El Salvador","Guatemala","Nicaragua","República Dominicana","Cuba",
  "España","Estados Unidos","Otro",
]

export async function GET(request: NextRequest) {
  try {
    const userIdFromQuery = request.nextUrl.searchParams.get("user_id")
    const requesterId = await getAuthenticatedUserId(request)

    if (!requesterId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    let userId = requesterId
    if (userIdFromQuery && userIdFromQuery !== requesterId) {
      const adminAuth = await requireBackofficeAdmin(request)
      if (!adminAuth.authorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      userId = userIdFromQuery
    }

    const supabase = createAdminSupabaseClient()

    let { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single()

    // Profile row missing (Supabase trigger may have failed) — auto-create it
    if (profileError || !profile) {
      const { data: authData } = await supabase.auth.admin.getUserById(userId)
      if (authData?.user) {
        const email = authData.user.email || ""
        const meta = authData.user.user_metadata || {}
        await supabase.from("profiles").upsert(
          { id: userId, email, nickname: meta.nickname || `user_${userId.slice(0, 8)}`, kyc_status: "none" },
          { onConflict: "id" }
        )
        // Ensure wallet exists — ignoreDuplicates so we NEVER overwrite an existing balance
        await supabase.from("wallets").upsert(
          { user_id: userId, balance_fantasy: 0, balance_real: 0, fantasy_total_accumulated: 0 },
          { onConflict: "user_id", ignoreDuplicates: true }
        )
        const { data: retried } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single()
        profile = retried
      }
    }

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      )
    }

    // Get wallet
    const { data: wallet } = await supabase
      .from("wallets")
      .select("balance_fantasy, balance_real, fantasy_total_accumulated")
      .eq("user_id", userId)
      .single()

    // Get bets for stats
    const { data: bets } = await supabase
      .from("bets")
      .select("status, winner_id")
      .or(`creator_id.eq.${userId},acceptor_id.eq.${userId}`)

    const totalBets = bets?.length || 0
    const wonBets = bets?.filter((b) => b.status === "resolved" && b.winner_id === userId).length || 0
    const winRate = totalBets > 0 ? Math.round((wonBets / totalBets) * 100) : 0

    return NextResponse.json({
      success: true,
      profile,
      wallet,
      stats: {
        total_bets: totalBets,
        won_bets: wonBets,
        win_rate: winRate,
        current_streak: 0,
      },
    })
  } catch (error) {
    console.error("Get profile error:", error)
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 })

    const updates: Record<string, unknown> = {}

    if (body.country !== undefined) {
      if (!ALLOWED_COUNTRIES.includes(body.country)) {
        return NextResponse.json({ error: "País inválido" }, { status: 400 })
      }
      updates.country = body.country
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 })
    }

    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select("id, nickname, country")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, profile: data })
  } catch (error) {
    console.error("PATCH profile error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
