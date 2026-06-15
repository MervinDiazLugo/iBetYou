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

  const supabase = createAdminSupabaseClient()
  const upserts: Array<{ key: string; value: string; updated_by: string; updated_at: string }> = []
  const now = new Date().toISOString()

  if (body?.iby_coin_price !== undefined) {
    const price = Number(body.iby_coin_price)
    if (!price || price <= 0) {
      return NextResponse.json({ error: "Precio inválido — debe ser mayor a 0" }, { status: 400 })
    }
    upserts.push({ key: "iby_coin_price", value: String(price), updated_by: auth.userId ?? "", updated_at: now })
  }

  if (body?.max_bet_amount !== undefined) {
    const max = Number(body.max_bet_amount)
    if (!max || max <= 0) {
      return NextResponse.json({ error: "Monto máximo inválido — debe ser mayor a 0" }, { status: 400 })
    }
    upserts.push({ key: "max_bet_amount", value: String(max), updated_by: auth.userId ?? "", updated_at: now })
  }

  if (body?.max_bet_amount_house !== undefined) {
    const max = Number(body.max_bet_amount_house)
    if (!max || max <= 0) {
      return NextResponse.json({ error: "Monto máximo casa inválido — debe ser mayor a 0" }, { status: 400 })
    }
    upserts.push({ key: "max_bet_amount_house", value: String(max), updated_by: auth.userId ?? "", updated_at: now })
  }

  if (upserts.length === 0) {
    return NextResponse.json({ error: "No hay parámetros válidos para actualizar" }, { status: 400 })
  }

  const { error } = await supabase.from("iby_settings").upsert(upserts)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
