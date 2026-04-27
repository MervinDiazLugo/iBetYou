import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  
  const user_id = searchParams.get('user_id')
  const limit = parseInt(searchParams.get('limit') || '50')

  try {
    let query = supabase.from('wallets').select(`
      *,
      user:profiles!wallets_user_id_fkey(id, nickname, email, avatar_url)
    `)

    if (user_id) {
      query = query.eq('user_id', user_id)
    }
    
    query = query.order('created_at', { ascending: false }).limit(limit)
    
    const { data, error } = await query
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ wallets: data })
  } catch (error: any) {
    console.error('Admin wallets error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
    const { action, user_id, amount, token_type, notes } = body

    if (!user_id || !amount || !token_type) {
      return NextResponse.json({ error: 'user_id, amount and token_type are required' }, { status: 400 })
    }

    if (amount <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }

    // Get current wallet
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user_id)
      .single()

    if (walletError || !wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
    }

    let updateQuery = supabase.from('wallets').update({} as Record<string, number>).eq('user_id', user_id)

    if (action === 'add') {
      if (token_type === 'fantasy') {
        updateQuery = supabase.from('wallets')
          .update({ balance_fantasy: wallet.balance_fantasy + amount })
          .eq('user_id', user_id)
      } else if (token_type === 'real') {
        updateQuery = supabase.from('wallets')
          .update({ balance_real: wallet.balance_real + amount })
          .eq('user_id', user_id)
      } else {
        return NextResponse.json({ error: 'Invalid token_type' }, { status: 400 })
      }
    } else if (action === 'subtract') {
      if (token_type === 'fantasy') {
        if (wallet.balance_fantasy < amount) {
          return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
        }
        // Optimistic lock: only update if balance hasn't changed since we read it
        updateQuery = supabase.from('wallets')
          .update({ balance_fantasy: wallet.balance_fantasy - amount })
          .eq('user_id', user_id)
          .eq('balance_fantasy', wallet.balance_fantasy)
      } else if (token_type === 'real') {
        if (wallet.balance_real < amount) {
          return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
        }
        updateQuery = supabase.from('wallets')
          .update({ balance_real: wallet.balance_real - amount })
          .eq('user_id', user_id)
          .eq('balance_real', wallet.balance_real)
      } else {
        return NextResponse.json({ error: 'Invalid token_type' }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: 'Invalid action. Use add or subtract' }, { status: 400 })
    }

    const { data: updatedWallet, error: updateError } = await (updateQuery as any).select().single()

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Balance changed concurrently, please retry' }, { status: 409 })
      }
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    const { error: txError } = await supabase.from('transactions').insert({
      user_id,
      token_type,
      amount: action === 'add' ? amount : -amount,
      operation: action === 'add' ? 'admin_deposit' : 'admin_withdrawal',
      notes: notes || `Admin ${action === 'add' ? 'deposit' : 'withdrawal'}`,
    })

    if (txError) {
      console.error('Admin wallet transaction record failed:', txError, { user_id, action, amount })
    }

    return NextResponse.json({ success: true, wallet: updatedWallet })
  } catch (error: any) {
    console.error('Admin wallet error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
