import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { createNotification } from "@/lib/notifications"
import { ACCEPT_WINDOW_MINUTES } from "@/lib/bet-constants"
import { payoutToMode } from "@/lib/wallet-utils"

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

    // For cancelled bets, enrich with who cancelled and why
    let cancellationInfo: { decided_by: string; decided_by_nickname: string | null; reason: string | null; action: string } | null = null
    if (bet.status === 'cancelled') {
      const { data: cancelDecision } = await supabase
        .from('arbitration_decisions')
        .select('decided_by, action, reason')
        .eq('bet_id', betId)
        .like('action', '%cancel%')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cancelDecision) {
        let nickname: string | null = null
        const decidedBy = cancelDecision.decided_by
        if (decidedBy && decidedBy !== 'system') {
          const { data: profile } = await supabase
            .from('profiles')
            .select('nickname')
            .eq('id', decidedBy)
            .maybeSingle()
          nickname = profile?.nickname ?? null
        }
        cancellationInfo = {
          decided_by: decidedBy === 'system' ? 'system' : 'user',
          decided_by_nickname: nickname,
          reason: cancelDecision.reason ?? null,
          action: cancelDecision.action,
        }
      }
    }

    return NextResponse.json({ bet: { ...bet, cancellation_info: cancellationInfo } })
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

    // Fetch bet and taker profile in parallel — both IDs are known before any DB call
    const [
      { data: bet, error: betError },
      { data: profile, error: profileError },
    ] = await Promise.all([
      supabase.from("bets").select(`*, event:events(*)`).eq("id", betId).single(),
      supabase.from("profiles").select("id, is_banned, role, betting_blocked_until").eq("id", effectiveUserId).single(),
    ])

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

    // Group bet: validate taker is a member of the group
    if ((bet as any).group_id) {
      const { data: gMembership } = await supabase
        .from("group_members")
        .select("role")
        .eq("group_id", (bet as any).group_id)
        .eq("user_id", effectiveUserId)
        .maybeSingle()
      if (!gMembership) {
        return NextResponse.json({ error: "Solo los miembros del grupo pueden tomar esta apuesta" }, { status: 403 })
      }
    }

    // Only exact score bets are asymmetric.
    const isAsymmetric = bet.bet_type === 'exact_score'
    const betMode = bet.mode === "real" ? "real" : "fantasy"
    const acceptorStake = isAsymmetric ? Number(bet.amount) * Math.max(1, Number(bet.multiplier) || 1) : Number(bet.amount)
    const acceptorFee = (bet as any).group_id ? 0 : acceptorStake * 0.03
    const totalNeeded = acceptorStake + acceptorFee

    // 1. Lock bet as taken FIRST (payment ordering invariant: status before money).
    // .eq("status", "open") is the optimistic lock — concurrent takers get PGRST116.
    const { data: updatedBet, error: updateError } = await supabase
      .from("bets")
      .update({ status: 'taken', acceptor_id: effectiveUserId })
      .eq("id", betId)
      .eq("status", "open")
      .select()
      .single()

    if (updateError || !updatedBet) {
      if (updateError?.code === "PGRST116") {
        return NextResponse.json({ error: 'Esta apuesta ya fue tomada por otro usuario' }, { status: 409 })
      }
      return NextResponse.json({ error: updateError?.message || 'No se pudo tomar la apuesta' }, { status: 500 })
    }

    // Helper: revert bet to open if wallet deduction fails below
    async function revertBetToOpen() {
      await supabase.from("bets").update({ status: "open", acceptor_id: null }).eq("id", betId).eq("status", "taken")
    }

    // 2. Deduct from taker wallet — bet is already locked as "taken"
    if ((bet as any).group_id) {
      const { ensureDailyGrant, deductFromGroupWallet } = await import("@/lib/group-wallet-utils")
      await ensureDailyGrant(supabase, (bet as any).group_id, effectiveUserId)
      try {
        await deductFromGroupWallet(supabase, (bet as any).group_id, effectiveUserId, totalNeeded)
      } catch (err: any) {
        await revertBetToOpen()
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
    } else if (betMode === "real") {
      const { data: ibcWallet } = await supabase
        .from("iby_wallets")
        .select("balance, balance_blocked")
        .eq("user_id", effectiveUserId)
        .single()
      if (!ibcWallet) {
        await revertBetToOpen()
        return NextResponse.json({ error: "IBC wallet not found" }, { status: 404 })
      }
      const available = Number(ibcWallet.balance) - Number(ibcWallet.balance_blocked)
      if (available < totalNeeded) {
        await revertBetToOpen()
        return NextResponse.json({ error: "Insufficient IBC balance" }, { status: 400 })
      }
      const takerBalance = Number(ibcWallet.balance)
      const takerBlocked = Number(ibcWallet.balance_blocked)
      const { data: ibcUpdated, error: ibcUpdateError } = await supabase
        .from("iby_wallets")
        .update({ balance: takerBalance - totalNeeded })
        .eq("user_id", effectiveUserId)
        .eq("balance", takerBalance)
        .eq("balance_blocked", takerBlocked)
        .select("user_id")
      if (ibcUpdateError || !ibcUpdated || ibcUpdated.length === 0) {
        await revertBetToOpen()
        return NextResponse.json({ error: "Tu saldo cambió. Recarga e intenta de nuevo." }, { status: 409 })
      }
    } else {
      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance_fantasy")
        .eq("user_id", effectiveUserId)
        .single()
      if (!wallet) {
        await revertBetToOpen()
        return NextResponse.json({ error: "Wallet not found" }, { status: 404 })
      }
      if (wallet.balance_fantasy < totalNeeded) {
        await revertBetToOpen()
        return NextResponse.json({ error: "Insufficient balance" }, { status: 400 })
      }
      const takerBalance = wallet.balance_fantasy
      const { data: fantasyUpdated, error: fantasyUpdateError } = await supabase
        .from("wallets")
        .update({ balance_fantasy: takerBalance - totalNeeded })
        .eq("user_id", effectiveUserId)
        .eq("balance_fantasy", takerBalance)
        .select("user_id")
      if (fantasyUpdateError || !fantasyUpdated || fantasyUpdated.length === 0) {
        await revertBetToOpen()
        return NextResponse.json({ error: "Tu saldo cambió. Recarga e intenta de nuevo." }, { status: 409 })
      }
    }

    // Record transaction for taker
    await supabase.from("transactions").insert({
      user_id: effectiveUserId,
      token_type: (bet as any).group_id ? "group_fantasy" : (betMode === "real" ? "iBY" : "fantasy"),
      amount: -totalNeeded,
      operation: "bet_taken",
      reference_id: betId,
    })

    // Note: We also need to record a transaction for the creator? 
    // The creator already had their balance deducted when they created the bet.
    // When the bet is taken, the creator's potential liability is covered, but no immediate balance change.
    // The actual payout will happen when the bet is resolved.

    // Notify creator that someone took their bet (include taker's nickname)
    const { data: takerProfile } = await supabase
      .from("profiles")
      .select("nickname")
      .eq("id", effectiveUserId)
      .single()
    const takerName = takerProfile?.nickname || "Un usuario"

    await createNotification({
      userId: bet.creator_id,
      type: "bet_taken",
      title: "¡Tu apuesta fue tomada!",
      body: `${takerName} tomó tu apuesta sobre ${eventRow?.home_team} vs ${eventRow?.away_team}`,
      betId: betId,
      mode: (bet as any).mode ?? "fantasy",
    })

    return NextResponse.json({ success: true, bet: updatedBet })
  } catch (error: any) {
    console.error('Take bet error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}