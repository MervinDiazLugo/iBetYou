import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const authenticatedUserId = await getAuthenticatedUserId(request)
  if (!authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  const user_id = searchParams.get('user_id')

  if (!user_id) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  if (user_id !== authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized user scope' }, { status: 403 })
  }

  try {
    const [
      { data: wallet, error },
      { data: profile, error: profileError },
      { data: thresholdSetting },
    ] = await Promise.all([
      supabase.from("wallets").select("balance_fantasy, balance_real").eq("user_id", user_id).single(),
      supabase.from("profiles").select("id, nickname, avatar_url, role").eq("id", user_id).single(),
      supabase.from("app_settings").select("value").eq("key", "fantasy_low_balance_threshold").maybeSingle(),
    ])

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
    }

    if (profileError) {
      console.error('Fetch profile error:', profileError.message)
    }

    const isAdmin = profile?.role === "backoffice_admin"
    const threshold = isAdmin ? null : Number(thresholdSetting?.value ?? 500)
    const low_balance = !isAdmin && threshold !== null && Number(wallet.balance_fantasy) < threshold

    return NextResponse.json({ wallet, user: profile, low_balance, low_balance_threshold: threshold })
  } catch (error: any) {
    console.error('Fetch wallet error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}