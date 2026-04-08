import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"

const ACCEPT_WINDOW_MINUTES = 10

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; }> }) {
  const authenticatedUserId = await getAuthenticatedUserId(request)
  const supabase = createAdminSupabaseClient()
  const paramsResolved = await context.params
  const betId = paramsResolved.id

  try {
    const { data: bet, error: betError } = await supabase
      .from("bets")
      .select(`
        *,
        event:events(*),
        creator:profiles!bets_creator_id_fkey(nickname, avatar_url),
        acceptor:profiles!bets_acceptor_id_fkey(nickname, avatar_url)
      `)
      .eq("id", betId)
      .single()

    if (betError || !bet) {
      return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
    }

    const isParticipant = !!authenticatedUserId && (authenticatedUserId === bet.creator_id || authenticatedUserId === bet.acceptor_id)

    const eventRow = Array.isArray(bet.event) ? bet.event[0] : bet.event
    const eventStartRaw = eventRow?.start_time
    const eventStartMs = eventStartRaw ? new Date(eventStartRaw).getTime() : NaN
    const acceptanceDeadlineMs = Number.isNaN(eventStartMs)
      ? NaN
      : eventStartMs + ACCEPT_WINDOW_MINUTES * 60 * 1000

    const canReadOpenByWindow =
      bet.status === 'open' && !Number.isNaN(acceptanceDeadlineMs) && Date.now() <= acceptanceDeadlineMs

    // Check if user is a backoffice admin
    let isAdmin = false
    if (authenticatedUserId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authenticatedUserId)
        .single()
      isAdmin = profile?.role === 'backoffice_admin'
    }

    // Admins can see all bets, participants can see their own, open bets are public during acceptance window
    const canRead = isAdmin || canReadOpenByWindow || isParticipant

    if (!canRead) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({ bet })
  } catch (error: any) {
    console.error('Get bet detail error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; }> }) {
  const authenticatedUserId = await getAuthenticatedUserId(request)
  if (!authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const paramsResolved = await context.params
  const betId = paramsResolved.id

  try {
    // Get user from request (we need to know who is taking the bet)
    // We'll expect user_id in the request body
    const body = await request.json()
    const { user_id } = body

    const effectiveUserId = authenticatedUserId

    if (!effectiveUserId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (authenticatedUserId && user_id && user_id !== authenticatedUserId) {
      return NextResponse.json({ error: 'Unauthorized user scope' }, { status: 403 })
    }

    // Fetch the bet to validate
    const { data: bet, error: betError } = await supabase
      .from("bets")
      .select(`
        *,
        event:events(*)
      `)
      .eq("id", betId)
      .single()

    if (betError || !bet) {
      return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
    }

    // Validate bet status
    if (bet.status !== 'open') {
      return NextResponse.json({ error: 'Bet is not available for taking' }, { status: 400 })
    }

    const eventRow = Array.isArray(bet.event) ? bet.event[0] : bet.event
    const eventStart = eventRow?.start_time ? new Date(eventRow.start_time) : null
    if (!eventStart || Number.isNaN(eventStart.getTime())) {
      return NextResponse.json({ error: 'Invalid event start time' }, { status: 400 })
    }

    const acceptanceDeadline = new Date(eventStart.getTime() + ACCEPT_WINDOW_MINUTES * 60 * 1000)
    if (new Date() > acceptanceDeadline) {
      return NextResponse.json(
        { error: `No se puede tomar la apuesta: pasaron más de ${ACCEPT_WINDOW_MINUTES} minutos desde el inicio del evento` },
        { status: 400 }
      )
    }

    // Validate user is not the creator
    if (bet.creator_id === effectiveUserId) {
      return NextResponse.json({ error: 'You cannot take your own bet' }, { status: 400 })
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, is_banned, role, betting_blocked_until")
      .eq("id", effectiveUserId)
      .single()

    if (profileError) {
      const missingColumn = profileError.message?.includes("betting_blocked_until")
      if (!missingColumn) {
        return NextResponse.json({ error: 'Failed to validate user profile' }, { status: 500 })
      }
    }

    if (profile?.is_banned) {
      return NextResponse.json({ error: 'User is banned from betting' }, { status: 403 })
    }

    if (profile?.role === "backoffice_admin") {
      return NextResponse.json({ error: 'Los usuarios de backoffice no pueden aceptar apuestas' }, { status: 403 })
    }

    if (profile?.betting_blocked_until) {
      const blockedUntil = new Date(profile.betting_blocked_until)
      if (blockedUntil > new Date()) {
        return NextResponse.json({
          error: `No puedes apostar hasta ${blockedUntil.toLocaleString("es-ES")}`,
          blocked_until: profile.betting_blocked_until,
        }, { status: 403 })
      }
    }

    // Validate user has sufficient balance
    const { data: wallet } = await supabase
      .from("wallets")
      .select("balance_fantasy")
      .eq("user_id", effectiveUserId)
      .single()

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
    }

    // Only exact score bets are asymmetric.
    const isAsymmetric = bet.bet_type === 'exact_score'
    const acceptorStake = isAsymmetric ? bet.amount * bet.multiplier : bet.amount
    const acceptorFee = acceptorStake * 0.03
    const totalNeeded = acceptorStake + acceptorFee

    if (wallet.balance_fantasy < totalNeeded) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
    }

    // Update the bet to taken
    const { data: updatedBet, error: updateError } = await supabase
      .from("bets")
      .update({
        status: 'taken',
        acceptor_id: effectiveUserId,
      })
      .eq("id", betId)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Deduct from taker's wallet
    await supabase
      .from("wallets")
      .update({
        balance_fantasy: wallet.balance_fantasy - totalNeeded,
      })
      .eq("user_id", effectiveUserId)

    // Record transaction for taker
    await supabase.from("transactions").insert({
      user_id: effectiveUserId,
      token_type: "fantasy",
      amount: -totalNeeded,
      operation: "bet_taken",
      reference_id: betId,
    })

    // Note: We also need to record a transaction for the creator? 
    // The creator already had their balance deducted when they created the bet.
    // When the bet is taken, the creator's potential liability is covered, but no immediate balance change.
    // The actual payout will happen when the bet is resolved.

    return NextResponse.json({ success: true, bet: updatedBet })
  } catch (error: any) {
    console.error('Take bet error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}