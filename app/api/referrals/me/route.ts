import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { getOrCreateReferralCode } from "@/lib/referrals"

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  let referralCode: string
  try {
    referralCode = await getOrCreateReferralCode(userId, supabase)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const shareUrl = `${origin}/?ref=${referralCode}`
  const whatsappText = encodeURIComponent(
    `¡Te invito a iBetYou! La plataforma donde apuestas directamente contra otros fans, sin casa de apuestas. Regístrate con mi código y recibe 50 fichas gratis: ${shareUrl}`
  )
  const whatsappUrl = `https://wa.me/?text=${whatsappText}`

  const { data: referrals } = await supabase
    .from("referral_bonuses")
    .select(`
      referee_id,
      wagering_progress,
      wagering_required,
      status,
      created_at,
      referee:profiles!referral_bonuses_referee_id_fkey(nickname)
    `)
    .eq("referrer_id", userId)
    .eq("beneficiary_id", userId)
    .order("created_at", { ascending: false })

  const { data: myBonus } = await supabase
    .from("referral_bonuses")
    .select("*")
    .eq("beneficiary_id", userId)
    .eq("referee_id", userId)
    .maybeSingle()

  return NextResponse.json({
    referral_code: referralCode,
    share_url: shareUrl,
    whatsapp_url: whatsappUrl,
    referrals: (referrals || []).map((r) => ({
      referee_id: r.referee_id,
      nickname: (r.referee as any)?.nickname ?? "Usuario",
      created_at: r.created_at,
      bonus_status: r.status,
      wagering_progress: r.wagering_progress,
      wagering_required: r.wagering_required,
    })),
    my_bonus: myBonus || null,
  })
}
