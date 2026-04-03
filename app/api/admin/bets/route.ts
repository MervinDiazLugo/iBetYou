import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY
const API_FOOTBALL_URL = process.env.API_FOOTBALL_URL || "https://v3.football.api-sports.io"
const API_BASEBALL_URL = process.env.API_BASEBALL_URL || "https://v1.baseball.api-sports.io"

type DecisionSource = 'manual' | 'auto' | 'system'

async function logArbitrationDecision(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  payload: {
    bet_id: string
    action: string
    previous_status?: string | null
    new_status?: string | null
    decided_winner_id?: string | null
    reason?: string | null
    details?: Record<string, unknown>
    decided_by?: string | null
    source?: DecisionSource
  }
) {
  try {
    await supabase.from('arbitration_decisions').insert({
      bet_id: payload.bet_id,
      action: payload.action,
      previous_status: payload.previous_status ?? null,
      new_status: payload.new_status ?? null,
      decided_winner_id: payload.decided_winner_id ?? null,
      reason: payload.reason ?? null,
      details: payload.details ?? null,
      decided_by: payload.decided_by ?? null,
      source: payload.source ?? 'manual',
    })
  } catch (error) {
    console.error('Failed to log arbitration decision:', error)
  }
}

async function applyFalseClaimPenalty(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  payload: {
    betId: string
    claimantId: string
    finalWinnerId: string
    claimedWinnerId?: string | null
  }
) {
  const { betId, claimantId, finalWinnerId, claimedWinnerId } = payload

  if (!claimedWinnerId || claimedWinnerId === finalWinnerId) {
    return
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('false_claim_count, betting_blocked_until')
    .eq('id', claimantId)
    .single()

  if (profileError) {
    const missingColumns =
      profileError.message?.includes('false_claim_count') ||
      profileError.message?.includes('betting_blocked_until')

    if (!missingColumns) {
      console.error('Failed to fetch profile for false-claim penalty:', profileError)
    }
    return
  }

  const nextCount = (profile?.false_claim_count || 0) + 1
  const updateData: Record<string, unknown> = {
    false_claim_count: nextCount,
  }

  if (nextCount >= 2) {
    const blockedUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
    updateData.betting_blocked_until = blockedUntil
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('id', claimantId)

  if (updateError) {
    const missingColumns =
      updateError.message?.includes('false_claim_count') ||
      updateError.message?.includes('betting_blocked_until')

    if (!missingColumns) {
      console.error('Failed to apply false-claim penalty:', updateError)
    }
    return
  }

  await logArbitrationDecision(supabase, {
    bet_id: betId,
    action: 'false_claim_penalty',
    previous_status: null,
    new_status: null,
    decided_winner_id: finalWinnerId,
    reason: nextCount >= 2
      ? 'Segundo reporte inexacto. Usuario bloqueado por 10 dias para apostar'
      : 'Reporte inexacto detectado. Primera advertencia registrada',
    details: {
      claimant_id: claimantId,
      claimed_winner_id: claimedWinnerId,
      final_winner_id: finalWinnerId,
      false_claim_count: nextCount,
      blocked_days: nextCount >= 2 ? 10 : 0,
    },
    decided_by: 'system',
    source: 'system',
  })
}

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  
  const status = searchParams.get('status')
  const limit = parseInt(searchParams.get('limit') || '50')

  try {
    let query = supabase.from('bets').select(`
      *,
      event:events(*),
      creator:profiles!bets_creator_id_fkey(nickname, avatar_url),
      acceptor:profiles!bets_acceptor_id_fkey(nickname, avatar_url)
    `)

    if (status) {
      query = query.eq('status', status)
    }
    
    query = query.order('created_at', { ascending: false }).limit(limit)
    
    const { data, error } = await query
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    const bets = data || []
    const betIds = bets.map((b) => b.id)

    let decisionsByBetId: Record<string, any[]> = {}
    if (betIds.length > 0) {
      const { data: decisions } = await supabase
        .from('arbitration_decisions')
        .select('*')
        .in('bet_id', betIds)
        .order('created_at', { ascending: false })

      decisionsByBetId = (decisions || []).reduce((acc, item) => {
        if (!acc[item.bet_id]) acc[item.bet_id] = []
        acc[item.bet_id].push(item)
        return acc
      }, {} as Record<string, any[]>)
    }

    const userIds = Array.from(new Set(
      bets.flatMap((bet) => [bet.creator_id, bet.acceptor_id].filter(Boolean))
    )) as string[]

    let emailByUserId: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: usersRes, error: listError } = await supabase.auth.admin.listUsers()
      if (listError) {
        return NextResponse.json({ error: listError.message }, { status: 500 })
      }

      emailByUserId = (usersRes.users || []).reduce((acc, user) => {
        if (user.id && user.email && userIds.includes(user.id)) {
          acc[user.id] = user.email
        }
        return acc
      }, {} as Record<string, string>)
    }

    const betsWithHistory = bets.map((b) => ({
      ...b,
      creator_email: emailByUserId[b.creator_id] || null,
      acceptor_email: b.acceptor_id ? (emailByUserId[b.acceptor_id] || null) : null,
      decision_history: decisionsByBetId[b.id] || [],
    }))

    return NextResponse.json({ bets: betsWithHistory })
  } catch (error: unknown) {
    console.error('Admin bets error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()
  
  try {
    const body = await request.json()
    const { bet_id, action, winner_id, bet_ids, approved, reason } = body
    const decidedBy = auth.userId || request.headers.get('x-admin-id') || request.headers.get('x-user-id') || 'admin'

    if (action === 'approve_pending' && bet_ids && Array.isArray(bet_ids)) {
      const results = []
      
      for (const id of bet_ids) {
        const { data: bet, error: betError } = await supabase
          .from('bets')
          .select('*, event:events(*), creator:profiles!bets_creator_id_fkey(id, nickname), acceptor:profiles!bets_acceptor_id_fkey(id, nickname)')
          .eq('id', id)
          .single()
        
        if (betError || !bet) {
          results.push({ id, success: false, error: betError?.message })
          continue
        }

        const creatorWinnings = bet.status === 'pending_resolution_creator' 
        const winnerUserId = creatorWinnings ? bet.creator_id : bet.acceptor_id
        
        const totalPrize = bet.amount * bet.multiplier + bet.amount
        
        const { data: winnerWallet } = await supabase
          .from('wallets')
          .select('balance_fantasy')
          .eq('user_id', winnerUserId)
          .single()
        
        if (winnerWallet) {
          await supabase
            .from('wallets')
            .update({ balance_fantasy: winnerWallet.balance_fantasy + totalPrize })
            .eq('user_id', winnerUserId)
          
          await supabase.from('transactions').insert({
            user_id: winnerUserId,
            token_type: 'fantasy',
            amount: totalPrize,
            operation: 'bet_won',
            reference_id: bet.id
          })
        }

        await supabase
          .from('bets')
          .update({ 
            status: 'resolved', 
            resolved_at: new Date().toISOString(),
            winner_id: winnerUserId 
          })
          .eq('id', id)

        await logArbitrationDecision(supabase, {
          bet_id: id,
          action: 'approve_pending',
          previous_status: bet.status,
          new_status: 'resolved',
          decided_winner_id: winnerUserId,
          reason: reason || 'Aprobacion manual de resolucion pendiente',
          details: {
            amount: bet.amount,
            multiplier: bet.multiplier,
            totalPrize,
          },
          decided_by: decidedBy,
          source: 'manual',
        })
        
        results.push({ id, success: true })
      }
      
      return NextResponse.json({ success: true, results })
    }

    if (!bet_id || !action) {
      return NextResponse.json({ error: 'bet_id and action are required' }, { status: 400 })
    }

    let updateData: Record<string, unknown> = {}
    let operation = ""

    switch (action) {
      case 'resolve':
        if (!winner_id) {
          return NextResponse.json({ error: 'winner_id is required to resolve' }, { status: 400 })
        }
        updateData = {
          status: 'resolved',
          winner_id,
          resolved_at: new Date().toISOString()
        }
        operation = "resolve"
        break
      case 'cancel': {
        // Fetch bet details before cancelling to process refunds
        const { data: betToCancel, error: fetchErr } = await supabase
          .from('bets')
          .select('id, creator_id, acceptor_id, amount, multiplier, fee_amount, type, bet_type, status')
          .eq('id', bet_id)
          .single()

        if (fetchErr || !betToCancel) {
          return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
        }

        const cancelledStatuses = ['cancelled', 'resolved']
        if (cancelledStatuses.includes(betToCancel.status)) {
          return NextResponse.json({ error: 'Bet is already resolved or cancelled' }, { status: 400 })
        }

        // Refund creator: they paid base amount + fee when creating
        const creatorRefund = betToCancel.amount + (betToCancel.fee_amount || 0)
        const { data: creatorWallet } = await supabase
          .from('wallets')
          .select('balance_fantasy')
          .eq('user_id', betToCancel.creator_id)
          .single()

        if (creatorWallet) {
          await supabase
            .from('wallets')
            .update({ balance_fantasy: creatorWallet.balance_fantasy + creatorRefund })
            .eq('user_id', betToCancel.creator_id)

          await supabase.from('transactions').insert({
            user_id: betToCancel.creator_id,
            token_type: 'fantasy',
            amount: creatorRefund,
            operation: 'bet_cancelled_refund',
            reference_id: bet_id,
          })
        }

        // Refund acceptor if the bet was already taken
        if (betToCancel.acceptor_id) {
          const acceptorStake = betToCancel.bet_type === 'exact_score'
            ? betToCancel.amount * betToCancel.multiplier
            : betToCancel.amount
          const acceptorRefund = acceptorStake + (acceptorStake * 0.03)

          const { data: acceptorWallet } = await supabase
            .from('wallets')
            .select('balance_fantasy')
            .eq('user_id', betToCancel.acceptor_id)
            .single()

          if (acceptorWallet) {
            await supabase
              .from('wallets')
              .update({ balance_fantasy: acceptorWallet.balance_fantasy + acceptorRefund })
              .eq('user_id', betToCancel.acceptor_id)

            await supabase.from('transactions').insert({
              user_id: betToCancel.acceptor_id,
              token_type: 'fantasy',
              amount: acceptorRefund,
              operation: 'bet_cancelled_refund',
              reference_id: bet_id,
            })
          }
        }

        updateData = { status: 'cancelled' }
        operation = "cancel"
        break
      }
      case 'dispute':
        updateData = {
          status: 'disputed',
        }
        operation = "dispute"
        break
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const { data: currentBet } = await supabase
      .from('bets')
      .select('id, status, winner_id, creator_id, acceptor_id, creator_claimed, acceptor_claimed')
      .eq('id', bet_id)
      .single()

    const { data: bet, error: betError } = await supabase
      .from("bets")
      .update(updateData)
      .eq("id", bet_id)
      .select()
      .single()

    if (betError) {
      return NextResponse.json({ error: betError.message }, { status: 500 })
    }

    await logArbitrationDecision(supabase, {
      bet_id,
      action: operation,
      previous_status: currentBet?.status || null,
      new_status: (updateData.status as string) || null,
      decided_winner_id: (updateData.winner_id as string) || null,
      reason: reason || null,
      details: { approved: approved ?? null },
      decided_by: decidedBy,
      source: 'manual',
    })

    if (action === 'resolve' && winner_id && currentBet) {
      const claimantId = currentBet.creator_claimed && !currentBet.acceptor_claimed
        ? currentBet.creator_id
        : currentBet.acceptor_claimed && !currentBet.creator_claimed
          ? currentBet.acceptor_id
          : null

      if (claimantId) {
        await applyFalseClaimPenalty(supabase, {
          betId: bet_id,
          claimantId,
          finalWinnerId: winner_id,
          claimedWinnerId: currentBet.winner_id,
        })
      }
    }

    return NextResponse.json({ success: true, bet, operation })
  } catch (error: unknown) {
    console.error('Admin bet action error:', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()
  
  try {
    const body = await request.json()
    const { bet_id, event_id } = body
    const decidedBy = auth.userId || request.headers.get('x-admin-id') || request.headers.get('x-user-id') || 'auto-resolver'

    if (!bet_id || !event_id) {
      return NextResponse.json({ error: 'bet_id and event_id are required' }, { status: 400 })
    }

    const { data: event } = await supabase
      .from('events')
      .select('*, external_id, sport, home_team, away_team, home_score, away_score, status')
      .eq('id', event_id)
      .single()

    if (!event || !event.external_id) {
      return NextResponse.json({ error: 'Event not found or has no external_id' }, { status: 404 })
    }

    const { data: bet } = await supabase
      .from('bets')
      .select('*, creator:profiles!bets_creator_id_fkey(nickname), acceptor:profiles!bets_acceptor_id_fkey(nickname)')
      .eq('id', bet_id)
      .single()

    if (!bet) {
      return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
    }

    if (bet.status !== 'taken') {
      return NextResponse.json({ error: 'Bet must be taken to auto-resolve' }, { status: 400 })
    }

    let homeScore = event.home_score
    let awayScore = event.away_score
    let scoreSource: 'database' | 'external_api' = 'database'

    // Prefer our stored event result; only hit external API if scores are still missing.
    if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) {
      scoreSource = 'external_api'
      const sportPrefix = event.external_id.split('_')[0]
      let apiUrl = ''
      
      if (sportPrefix === 'football') {
        apiUrl = `${API_FOOTBALL_URL}/fixtures?id=${event.external_id.split('_')[1]}`
      } else if (sportPrefix === 'baseball') {
        apiUrl = `${API_BASEBALL_URL}/games?id=${event.external_id.split('_')[1]}`
      } else {
        apiUrl = `${API_FOOTBALL_URL}/fixtures?id=${event.external_id.split('_')[1]}`
      }

      const apiResponse = await fetch(apiUrl, {
        headers: { "x-apisports-key": API_FOOTBALL_KEY! },
        next: { revalidate: 0 }
      })

      if (!apiResponse.ok) {
        return NextResponse.json({ error: 'Failed to fetch external API' }, { status: 500 })
      }

      const apiData = await apiResponse.json()
      const fixture = apiData.response?.[0]

      if (!fixture) {
        return NextResponse.json({ error: 'No fixture data found' }, { status: 404 })
      }

      homeScore = fixture.goals?.home ?? fixture.scores?.home
      awayScore = fixture.goals?.away ?? fixture.scores?.away

      await supabase
        .from('events')
        .update({ 
          home_score: homeScore, 
          away_score: awayScore,
          status: fixture.fixture.status.short === 'FT' ? 'finished' : 
                  fixture.fixture.status.short === 'NS' ? 'scheduled' : 'live'
        })
        .eq('id', event_id)
    }

    let creatorSelection = bet.creator_selection
    let acceptorSelection = bet.acceptor_selection
    
    if (bet.selection) {
      try {
        const parsed = JSON.parse(bet.selection)
        creatorSelection = parsed.selection || parsed.creator_selection || bet.creator_selection
        acceptorSelection = parsed.acceptor_selection || ''
      } catch { /* empty */ }
    }

    let winner_id: string | null = null
    let pendingStatus: string | null = null
    let reason = ''

    if (bet.bet_type === 'direct') {
      if (homeScore > awayScore) {
        winner_id = bet.creator_id
        pendingStatus = 'pending_resolution_creator'
      } else if (awayScore > homeScore) {
        winner_id = bet.acceptor_id
        pendingStatus = 'pending_resolution_acceptor'
      } else if (event.sport === 'baseball') {
        reason = 'Empate en béisbol - requiere revisión manual'
      } else {
        await supabase
          .from('bets')
          .update({ status: 'resolved', winner_id: 'tie', resolved_at: new Date().toISOString() })
          .eq('id', bet_id)

        await logArbitrationDecision(supabase, {
          bet_id,
          action: 'auto_resolve_tie',
          previous_status: 'taken',
          new_status: 'resolved',
          reason: 'Empate detectado por auto-resolucion',
          details: { homeScore, awayScore },
          decided_by: decidedBy,
          source: 'auto',
        })

        return NextResponse.json({ 
          success: true, 
          result: 'tie', 
          homeScore, 
          awayScore,
          score_source: scoreSource,
          message: 'Empate - dinero devuelto a ambos'
        })
      }
    } else if (bet.bet_type === 'exact_score') {
      const creatorParts = creatorSelection?.split('-') || []
      const acceptorParts = acceptorSelection?.split('-') || []
      
      const creatorHome = parseInt(creatorParts[0]) || 0
      const creatorAway = parseInt(creatorParts[1]) || 0
      const acceptorHome = parseInt(acceptorParts[0]) || 0
      const acceptorAway = parseInt(acceptorParts[1]) || 0

      const creatorMatch = homeScore === creatorHome && awayScore === creatorAway
      const acceptorMatch = homeScore === acceptorHome && awayScore === acceptorAway

      if (creatorMatch && !acceptorMatch) {
        winner_id = bet.creator_id
        pendingStatus = 'pending_resolution_creator'
      } else if (acceptorMatch && !creatorMatch) {
        winner_id = bet.acceptor_id
        pendingStatus = 'pending_resolution_acceptor'
      } else if (!creatorMatch && !acceptorMatch) {
        reason = 'Ningún usuario acertó el score exacto'
      } else {
        reason = 'Ambos acertaron el score - requiere revisión'
      }
    } else {
      reason = `Tipo de apuesta ${bet.bet_type} no soportado para auto-resolución`
    }

    if (reason) {
      await supabase
        .from('bets')
        .update({ status: 'disputed' })
        .eq('id', bet_id)

      await logArbitrationDecision(supabase, {
        bet_id,
        action: 'auto_resolve_disputed',
        previous_status: 'taken',
        new_status: 'disputed',
        reason,
        details: { homeScore, awayScore, bet_type: bet.bet_type },
        decided_by: decidedBy,
        source: 'auto',
      })

      return NextResponse.json({ 
        success: false, 
        error: reason,
        homeScore,
        awayScore,
        score_source: scoreSource,
      })
    }

    await supabase
      .from('bets')
      .update({ 
        status: pendingStatus,
        winner_id: winner_id
      })
      .eq('id', bet_id)

    await logArbitrationDecision(supabase, {
      bet_id,
      action: 'auto_resolve_pending',
      previous_status: 'taken',
      new_status: pendingStatus,
      decided_winner_id: winner_id,
      reason: 'Auto-resuelto y enviado a aprobacion manual',
      details: { homeScore, awayScore, bet_type: bet.bet_type },
      decided_by: decidedBy,
      source: 'auto',
    })

    await supabase
      .from('events')
      .update({
        home_score: homeScore,
        away_score: awayScore
      })
      .eq('id', event_id)

    return NextResponse.json({ 
      success: true, 
      pending_approval: true,
      homeScore, 
      awayScore,
      score_source: scoreSource,
      winner_id,
      bet_id
    })

  } catch (error: unknown) {
    console.error('Auto-resolve error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}