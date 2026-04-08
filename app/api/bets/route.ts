import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

const ACCEPT_WINDOW_MINUTES = 10

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') // my_open, my_active, my_created_taken
  const userId = searchParams.get('user_id')
  const limit = parseInt(searchParams.get('limit') || '20')
  const sport = searchParams.get('sport')

  // Public marketplace reads (safe):
  // - default listing -> open bets
  // - taken listing -> taken bets for cloning UI
  const isPublicMarketplaceRead = !type || type === 'taken'

  const authenticatedUserId = await getAuthenticatedUserId(request)
  if (!isPublicMarketplaceRead && !authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  
  try {
    if (authenticatedUserId && userId && userId !== authenticatedUserId) {
      return NextResponse.json({ error: 'Unauthorized user scope' }, { status: 403 })
    }

    let query = supabase.from('bets').select(`
      *,
      event:events(*),
      creator:profiles!creator_id(nickname, avatar_url)
    `)

    // Apply filters based on type
    if (type === 'all') {
      // Debug: get all bets
    } else if (type === 'my_open' && userId) {
      // User's open bets (created by user, still open - waiting for someone to take)
      query = query.eq('creator_id', userId).eq('status', 'open')
    } else if (type === 'my_created_taken' && userId) {
      // User created these bets and someone else took them (en curso - el creador ve esto)
      query = query.eq('creator_id', userId).eq('status', 'taken')
    } else if (type === 'my_taken' && userId) {
      // Bets that the user took from others (en curso - el acceptor ve esto)
      query = query.eq('acceptor_id', userId).eq('status', 'taken')
    } else if (type === 'my_active' && userId) {
      // User's active bets: open (created by user, waiting) OR taken (user is creator or acceptor)
      query = query.or(`and(creator_id.eq.${userId},status.eq.open),and(creator_id.eq.${userId},status.eq.taken),and(acceptor_id.eq.${userId},status.eq.taken)`)
    } else if (type === 'taken') {
      // All taken bets (for cloning) - exclude user's own bets
      query = query.eq('status', 'taken')
      if (userId) {
        query = query.neq('creator_id', userId)
      }
    } else {
      // Marketplace: only open bets where user is NOT the creator
      query = query.eq('status', 'open')
      if (userId) {
        query = query.neq('creator_id', userId)
      }
    }
    
    // Apply ordering and limit
    query = query.order('created_at', { ascending: false })
    if (limit) {
      query = query.limit(limit)
    }
    
    const { data, error } = await query
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    let bets = data || []

    // Marketplace only: show open bets only if event started <= 10 minutes ago (or has not started yet).
    if (!type) {
      const acceptanceDeadlineNow = Date.now() - (ACCEPT_WINDOW_MINUTES * 60 * 1000)
      bets = bets.filter((bet: any) => {
        const startRaw = bet?.event?.start_time
        if (!startRaw) return false

        const startMs = new Date(startRaw).getTime()
        if (Number.isNaN(startMs)) return false

        return startMs >= acceptanceDeadlineNow
      })
    }

    if (sport && sport !== 'all') {
      bets = bets.filter((bet: any) => bet.event?.sport === sport)
    }

    return NextResponse.json({ bets })
  } catch (error: any) {
    console.error('Fetch bets error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authenticatedUserId = await getAuthenticatedUserId(request)
  if (!authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  
  try {
    const body = await request.json()
    const { user_id, event_id, bet_type, creator_selection, amount, multiplier } = body
    const footballOnlyBetTypes = new Set(['half_time', 'first_scorer'])

    if (!user_id || user_id !== authenticatedUserId) {
      return NextResponse.json({ error: 'Unauthorized user scope' }, { status: 403 })
    }

    const { data: eventRow, error: eventError } = await supabase
      .from('events')
      .select('id, sport')
      .eq('id', event_id)
      .single()

    if (eventError || !eventRow) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    if (footballOnlyBetTypes.has(bet_type) && eventRow.sport !== 'football') {
      return NextResponse.json({ error: 'Este tipo de apuesta solo esta disponible para futbol' }, { status: 400 })
    }

    const isAsymmetric = bet_type === 'exact_score'
    const finalMultiplier = isAsymmetric ? (multiplier || 1) : 1

    // Calculate fee
    const fee = amount * 0.03

    // Get wallet
    const { data: wallet } = await supabase
      .from("wallets")
      .select("balance_fantasy, fantasy_total_accumulated")
      .eq("user_id", user_id)
      .single()

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
    }

    // Creator always reserves base amount plus fee
    const totalNeeded = amount + fee
    
    if (wallet.balance_fantasy < totalNeeded) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
    }

    // Create bet
    const { data: bet, error: betError } = await supabase
      .from("bets")
      .insert({
        event_id,
        creator_id: user_id,
        type: isAsymmetric ? 'asymmetric' : 'symmetric',
        bet_type: bet_type || 'direct',
        selection: JSON.stringify({ betType: bet_type }),
        amount,
        multiplier: finalMultiplier,
        fee_amount: fee,
        creator_selection,
        status: 'open',
      })
      .select()
      .single()

    if (betError) {
      return NextResponse.json({ error: betError.message }, { status: 500 })
    }

    // Update wallet
    await supabase
      .from("wallets")
      .update({
        balance_fantasy: wallet.balance_fantasy - totalNeeded,
      })
      .eq("user_id", user_id)

    // Record transaction
    await supabase.from("transactions").insert({
      user_id,
      token_type: "fantasy",
      amount: -totalNeeded,
      operation: "bet_created",
      reference_id: bet.id,
    })

    return NextResponse.json({ success: true, bet })
  } catch (error) {
    console.error('Create bet error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
