import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const authenticatedUserId = await getAuthenticatedUserId(request)
  if (!authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()

  try {
    const { searchParams } = new URL(request.url)
    const user_id = searchParams.get('user_id')

    if (!user_id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (user_id !== authenticatedUserId) {
      return NextResponse.json({ error: 'Unauthorized user scope' }, { status: 403 })
    }

    const { data: betsData, error: betsError } = await supabase
      .from("bets")
      .select(`
        *,
        event:events(*),
        creator:profiles!creator_id(nickname),
        acceptor:profiles!acceptor_id(nickname)
      `)
      .or(`creator_id.eq.${user_id},acceptor_id.eq.${user_id}`)
      .order("created_at", { ascending: false })

    if (betsError) {
      return NextResponse.json({ error: betsError.message }, { status: 500 })
    }

    return NextResponse.json({ bets: betsData })
  } catch (error: any) {
    console.error('Get my bets error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}