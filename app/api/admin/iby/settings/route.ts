import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()

  const { data: settings, error } = await supabase
    .from("iby_settings")
    .select("key, value, updated_by, updated_at")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ settings: settings || [] })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const body = await request.json().catch(() => null)
  const price = Number(body?.iby_coin_price)

  if (!price || price <= 0) {
    return NextResponse.json({ error: "Precio inválido — debe ser mayor a 0" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()

  const { error } = await supabase
    .from("iby_settings")
    .upsert({
      key: "iby_coin_price",
      value: String(price),
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, iby_coin_price: price })
}
