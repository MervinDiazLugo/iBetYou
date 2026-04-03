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

    let newBalance = wallet.balance_fantasy
    let newRealBalance = wallet.balance_real

    if (action === 'add') {
      if (token_type === 'fantasy') {
        newBalance = wallet.balance_fantasy + amount
      } else if (token_type === 'real') {
        newRealBalance = wallet.balance_real + amount
      }
    } else if (action === 'subtract') {
      if (token_type === 'fantasy') {
        if (wallet.balance_fantasy < amount) {
          return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
        }
        newBalance = wallet.balance_fantasy - amount
      } else if (token_type === 'real') {
        if (wallet.balance_real < amount) {
          return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
        }
        newRealBalance = wallet.balance_real - amount
      }
    } else {
      return NextResponse.json({ error: 'Invalid action. Use add or subtract' }, { status: 400 })
    }

    // Update wallet
    const { data: updatedWallet, error: updateError } = await supabase
      .from('wallets')
      .update({
        balance_fantasy: newBalance,
        balance_real: newRealBalance
      })
      .eq('user_id', user_id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Record transaction
    const transaction = await supabase.from('transactions').insert({
      user_id,
      token_type,
      amount: action === 'add' ? amount : -amount,
      operation: action === 'add' ? 'admin_deposit' : 'admin_withdrawal',
      notes: notes || `Admin ${action === 'add' ? 'deposit' : 'withdrawal'}`
    })

    return NextResponse.json({ 
      success: true, 
      wallet: updatedWallet,
      transaction
    })
  } catch (error: any) {
    console.error('Admin wallet error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
