export interface User {
  id: string
  email: string
  nickname: string
  avatar_url: string | null
  kyc_status: 'none' | 'pending' | 'approved' | 'rejected'
  created_at: string
}

export interface Wallet {
  id: string
  user_id: string
  balance_fantasy: number
  balance_real: number
  fantasy_total_accumulated: number
}

export interface Event {
  id: number
  sport: 'football' | 'basketball' | 'baseball'
  home_team: string
  away_team: string
  home_logo?: string
  away_logo?: string
  start_time: string
  status: 'scheduled' | 'live' | 'finished'
  home_score?: number
  away_score?: number
  league: string
  country: string
  metadata?: {
    venue?: {
      name?: string | null
      city?: string | null
    }
  }
}

export interface Bet {
  id: string
  event_id: number
  creator_id: string
  acceptor_id: string | null
  type: 'symmetric' | 'asymmetric' | 'market'
  bet_type: string
  selection: string
  amount: number
  multiplier: number
  fee_amount: number
  creator_selection: string
  acceptor_selection: string | null
  status: 'open' | 'taken' | 'pending_resolution' | 'resolved' | 'cancelled' | 'disputed'
  winner_id: string | null
  created_at: string
  // Joined fields
  event?: Event
  creator?: User
  acceptor?: User
}

export interface Transaction {
  id: string
  user_id: string
  token_type: 'fantasy' | 'real'
  amount: number
  operation: string
  reference_id: string | null
  created_at: string
}
