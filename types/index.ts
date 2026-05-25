export interface User {
  id: string
  email: string
  nickname: string
  avatar_url: string | null
  kyc_status: 'none' | 'pending' | 'approved' | 'rejected'
  country?: string | null
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
  status: 'scheduled' | 'live' | 'finished' | 'postponed'
  home_score?: number
  away_score?: number
  league: string
  country: string
  featured?: boolean
  metadata?: {
    venue?: {
      name?: string | null
      city?: string | null
    }
    predictions?: {
      percent?: { home: string; draw: string; away: string } | null
      advice?: string | null
      winner?: string | null
      home_form?: string | null
      away_form?: string | null
      home_goals_avg?: string | null
      away_goals_avg?: string | null
      home_league_form?: string | null
      away_league_form?: string | null
      comparison?: Record<string, { home: string; away: string }> | null
      h2h?: Array<{ date: string | null; home: string | null; away: string | null; home_score: number | null; away_score: number | null }>
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
  mode: 'fantasy' | 'real'
  status: 'open' | 'taken' | 'pending_resolution' | 'resolved' | 'cancelled' | 'disputed'
  winner_id: string | null
  house_bet?: boolean
  house_odds?: number | null
  potential_payout?: number | null
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

export interface ReferralBonus {
  id: string
  beneficiary_id: string
  referrer_id: string
  referee_id: string
  bonus_amount: number
  wagering_required: number
  wagering_progress: number
  status: 'locked' | 'unlocked' | 'claimed'
  created_at: string
  unlocked_at: string | null
}

export interface ReferralStats {
  referral_code: string
  share_url: string
  whatsapp_url: string
  referral_count: number
  max_referrals: number
  referrals: Array<{
    referee_id: string
    nickname: string
    created_at: string
    bonus_status: 'locked' | 'unlocked' | 'claimed'
    wagering_progress: number
    wagering_required: number
  }>
  my_bonus: ReferralBonus | null
}

export interface HouseWallet {
  id: number
  balance_fantasy: number
  balance_real: number
  updated_at: string
}
