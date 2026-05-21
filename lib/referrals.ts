import { randomBytes } from "crypto"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { createNotification } from "@/lib/notifications"

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

const BONUS_AMOUNT = 50
const WAGERING_MULTIPLIER = 15
const MIN_BET_FOR_WAGERING = 10

export function generateReferralCode(): string {
  return randomBytes(4).toString("hex").toUpperCase()
}

/**
 * Called in the auth callback after a new user registers.
 * Validates the referral code, creates bonus rows, credits locked tokens.
 * Silent on invalid code — never throws.
 */
export async function applyReferral(
  newUserId: string,
  referralCode: string,
  supabase: AdminClient
): Promise<void> {
  try {
    // Find referrer by code
    const { data: referrer } = await supabase
      .from("profiles")
      .select("id, referral_count, max_referrals, referred_by, nickname")
      .eq("referral_code", referralCode)
      .single()

    if (!referrer) return

    // Anti-fraud: self-referral
    if (referrer.id === newUserId) return

    // Anti-fraud: circular referral (referrer was referred by this new user)
    if (referrer.referred_by === newUserId) return

    // Anti-fraud: max referrals reached
    const maxReferrals = referrer.max_referrals ?? 50
    if (referrer.referral_count >= maxReferrals) return

    // Anti-fraud: new user already has a referrer
    const { data: newUserProfile } = await supabase
      .from("profiles")
      .select("referred_by, nickname")
      .eq("id", newUserId)
      .single()

    if (!newUserProfile || newUserProfile.referred_by) return

    // Set referred_by atomically — if already set (race), this returns no rows
    const { data: updatedProfile, error: referredByError } = await supabase
      .from("profiles")
      .update({ referred_by: referrer.id })
      .eq("id", newUserId)
      .is("referred_by", null)
      .select("id")
      .single()

    if (referredByError || !updatedProfile) return // Race condition: already processed

    // Atomic increment avoids race condition with concurrent referrals
    await supabase.rpc("increment_referral_count", { p_user_id: referrer.id })

    const wageringRequired = BONUS_AMOUNT * WAGERING_MULTIPLIER

    // Insert bonus rows for both parties
    await supabase.from("referral_bonuses").insert([
      {
        beneficiary_id: referrer.id,
        referrer_id: referrer.id,
        referee_id: newUserId,
        bonus_amount: BONUS_AMOUNT,
        wagering_required: wageringRequired,
        wagering_progress: 0,
        status: "locked",
      },
      {
        beneficiary_id: newUserId,
        referrer_id: referrer.id,
        referee_id: newUserId,
        bonus_amount: BONUS_AMOUNT,
        wagering_required: wageringRequired,
        wagering_progress: 0,
        status: "locked",
      },
    ])

    // Credit locked bonus to both wallets
    const { error: rpcError1 } = await supabase.rpc("increment_referral_bonus_locked_ibc", {
      p_user_id: referrer.id,
      p_amount: BONUS_AMOUNT,
    })
    if (rpcError1) {
      console.error("Failed to credit referrer bonus locked:", rpcError1)
      return
    }

    const { error: rpcError2 } = await supabase.rpc("increment_referral_bonus_locked_ibc", {
      p_user_id: newUserId,
      p_amount: BONUS_AMOUNT,
    })
    if (rpcError2) {
      console.error("Failed to credit referee bonus locked:", rpcError2)
      return
    }

    // Log transactions
    await supabase.from("transactions").insert([
      {
        user_id: referrer.id,
        token_type: "iBY",
        amount: BONUS_AMOUNT,
        operation: "referral_bonus",
        reference_id: null,
      },
      {
        user_id: newUserId,
        token_type: "iBY",
        amount: BONUS_AMOUNT,
        operation: "referral_bonus",
        reference_id: null,
      },
    ])

    // Notify referrer
    await createNotification(
      {
        userId: referrer.id,
        type: "referral_registered",
        title: `¡Tu referido ${newUserProfile.nickname ?? "un amigo"} se registró!`,
        body: `${newUserProfile.nickname ?? "Tu referido"} se registró con tu código. ¡Sigue apostando para desbloquear tu bono!`,
        betId: null,
      },
      supabase
    )
  } catch (err) {
    console.error("applyReferral failed:", err)
  }
}

/**
 * Called after every bet resolution for both creator and acceptor.
 * Increments wagering progress on any locked referral bonuses.
 * Unlocks the bonus when wagering_required is met.
 */
export async function updateWageringProgress(
  userId: string,
  betAmount: number,
  supabase: AdminClient,
  betMode: string = "fantasy"
): Promise<void> {
  if (betMode !== "real") return  // Only real bets count toward iBY referral bonus
  if (betAmount < MIN_BET_FOR_WAGERING) return

  try {
    const { data: bonuses } = await supabase
      .from("referral_bonuses")
      .select("id, wagering_progress, wagering_required, bonus_amount")
      .eq("beneficiary_id", userId)
      .eq("status", "locked")

    if (!bonuses || bonuses.length === 0) return

    for (const bonus of bonuses) {
      const newProgress = bonus.wagering_progress + betAmount

      if (newProgress >= bonus.wagering_required) {
        // Unlock: update bonus status
        await supabase
          .from("referral_bonuses")
          .update({
            wagering_progress: newProgress,
            status: "unlocked",
            unlocked_at: new Date().toISOString(),
          })
          .eq("id", bonus.id)
          .eq("status", "locked") // optimistic lock

        // Move locked bonus to iby_wallets balance
        await supabase.rpc("unlock_referral_bonus_ibc", {
          p_user_id: userId,
          p_amount: bonus.bonus_amount,
        })

        // Log transaction
        await supabase.from("transactions").insert({
          user_id: userId,
          token_type: "iBY",
          amount: bonus.bonus_amount,
          operation: "referral_bonus_unlock",
          reference_id: bonus.id,
        })

        // Notify user
        await createNotification(
          {
            userId,
            type: "referral_bonus_unlocked",
            title: "¡Bono de referido desbloqueado!",
            body: `${bonus.bonus_amount} fichas de referido ya están disponibles en tu saldo.`,
            betId: null,
          },
          supabase
        )
      } else {
        // Just update progress
        await supabase
          .from("referral_bonuses")
          .update({ wagering_progress: newProgress })
          .eq("id", bonus.id)
          .eq("status", "locked")
      }
    }
  } catch (err) {
    console.error("updateWageringProgress failed:", err)
  }
}

/**
 * Gets or creates a referral code for a user.
 */
export async function getOrCreateReferralCode(
  userId: string,
  supabase: AdminClient
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .single()

  if (profile?.referral_code) return profile.referral_code

  const code = generateReferralCode()
  const { error } = await supabase
    .from("profiles")
    .update({ referral_code: code })
    .eq("id", userId)

  if (error) throw new Error(`Failed to persist referral code: ${error.message}`)

  return code
}
