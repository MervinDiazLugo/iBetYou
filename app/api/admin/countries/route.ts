import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from("country_configs")
    .select("country_code, country_name, real_money_enabled, house_betting_fantasy_enabled, house_betting_real_enabled, groups_enabled, created_at")
    .order("country_name")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ countries: data || [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const body = await request.json().catch(() => null)
  if (!body?.country_code || !body?.country_name) {
    return NextResponse.json({ error: "country_code y country_name requeridos" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from("country_configs")
    .upsert({
      country_code: body.country_code,
      country_name: body.country_name,
      real_money_enabled: body.real_money_enabled ?? false,
      house_betting_fantasy_enabled: body.house_betting_fantasy_enabled ?? false,
      house_betting_real_enabled: body.house_betting_real_enabled ?? false,
      groups_enabled: body.groups_enabled ?? true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ country: data }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const body = await request.json().catch(() => null)
  if (!body?.country_code) {
    return NextResponse.json({ error: "country_code requerido" }, { status: 400 })
  }

  const ALLOWED_FIELDS = ["real_money_enabled", "house_betting_fantasy_enabled", "house_betting_real_enabled", "groups_enabled"] as const
  const updates: Record<string, boolean> = {}
  for (const field of ALLOWED_FIELDS) {
    if (typeof body[field] === "boolean") updates[field] = body[field]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Se requiere al menos un campo booleano válido" }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()
  const { error } = await supabase
    .from("country_configs")
    .update(updates)
    .eq("country_code", body.country_code)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) return auth.response

  const { searchParams } = new URL(request.url)
  const country_code = searchParams.get("country_code")
  if (!country_code) return NextResponse.json({ error: "country_code requerido" }, { status: 400 })

  const supabase = createAdminSupabaseClient()
  const { error } = await supabase
    .from("country_configs")
    .delete()
    .eq("country_code", country_code)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
