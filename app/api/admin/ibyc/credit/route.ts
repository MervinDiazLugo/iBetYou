import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { user_id, amount, notes } = await request.json()
  if (!user_id || !amount || Number(amount) <= 0) {
    return NextResponse.json({ error: "user_id y amount requeridos" }, { status: 400 })
  }

  const amountIbyc = Number(amount)
  const supabase = createAdminSupabaseClient()

  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance_real")
    .eq("user_id", user_id)
    .single()

  if (!wallet) return NextResponse.json({ error: "Wallet no encontrada" }, { status: 404 })

  const { data: credited, error } = await supabase
    .from("wallets")
    .update({ balance_real: wallet.balance_real + amountIbyc })
    .eq("user_id", user_id)
    .eq("balance_real", wallet.balance_real)
    .select("balance_real")
    .single()

  if (error || !credited) {
    return NextResponse.json({ error: "Conflicto de balance. Intente de nuevo." }, { status: 409 })
  }

  await supabase.from("transactions").insert({
    user_id,
    token_type: "real",
    amount: amountIbyc,
    operation: "admin_ibyc_credit",
    reference_id: null,
  })

  return NextResponse.json({ success: true, credited: amountIbyc, notes: notes ?? null })
}
