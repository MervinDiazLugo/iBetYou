import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const token = authHeader.slice(7)
    const supabase = createServerSupabaseClient()

    // Verify the token and get user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)

    if (userError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    // After token verification, use admin client for DB reads to avoid RLS returning empty wallet/profile.
    const adminSupabase = createAdminSupabaseClient()

    // Get profile
    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("nickname, role, is_banned")
      .eq("id", user.id)
      .single()

    // Get wallet
    const { data: wallet } = await adminSupabase
      .from("wallets")
      .select("balance_fantasy, balance_real")
      .eq("user_id", user.id)
      .single()

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nickname: profile?.nickname || "Usuario",
        role: profile?.role || "app_user",
        is_banned: !!profile?.is_banned,
      },
      balance: {
        fantasy: wallet?.balance_fantasy || 0,
        real: wallet?.balance_real || 0,
      },
    })
  } catch (error) {
    console.error("Get user info error:", error)
    return NextResponse.json(
      { error: "Failed to fetch user info" },
      { status: 500 }
    )
  }
}
