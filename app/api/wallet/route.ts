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
    const { data: wallet, error } = await supabase
      .from("wallets")
      .select("balance_fantasy, balance_real")
      .eq("user_id", user_id)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, nickname, avatar_url, role")
      .eq("id", user_id)
      .single()

    if (profileError) {
      console.error('Fetch profile error:', profileError.message)
    }

    return NextResponse.json({ wallet, user: profile })
  } catch (error: any) {
    console.error('Fetch wallet error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}