import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { getAuthenticatedUserId } from "@/lib/server-auth"
import { canCountryUseGroups } from "@/lib/country-access"

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  const { data: memberships, error } = await supabase
    .from("group_members")
    .select("role, group:groups(id, name, code, sport, league, status, created_at)")
    .eq("user_id", userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const groupIds = (memberships || [])
    .map((m: any) => m.group?.id)
    .filter(Boolean) as string[]

  if (groupIds.length === 0) return NextResponse.json({ groups: [] })

  const [walletsRes, countRes] = await Promise.all([
    supabase.from("group_wallets").select("group_id, balance").eq("user_id", userId).in("group_id", groupIds),
    supabase.from("group_members").select("group_id").in("group_id", groupIds),
  ])

  const walletMap = new Map<string, number>()
  for (const w of walletsRes.data || []) walletMap.set(w.group_id, Number(w.balance))

  const countMap = new Map<string, number>()
  for (const m of countRes.data || []) countMap.set(m.group_id, (countMap.get(m.group_id) ?? 0) + 1)

  const groups = (memberships || []).map((m: any) => ({
    ...m.group,
    my_balance: walletMap.get(m.group?.id) ?? 0,
    member_count: countMap.get(m.group?.id) ?? 1,
    my_role: m.role,
  }))

  return NextResponse.json({ groups })
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminSupabaseClient()

  const { data: profile } = await supabase.from("profiles").select("role, country").eq("id", userId).single()
  if (profile?.role === "backoffice_admin") {
    return NextResponse.json({ error: "Los admins no pueden crear grupos" }, { status: 403 })
  }
  if (!(await canCountryUseGroups(profile?.country ?? null))) {
    return NextResponse.json({ error: "Los grupos no están disponibles en tu país" }, { status: 403 })
  }

  const { name, sport, league } = await request.json() as { name?: string; sport?: string | null; league?: string | null }

  if (!name?.trim()) return NextResponse.json({ error: "El nombre del grupo es requerido" }, { status: 400 })
  if (name.trim().length > 40) return NextResponse.json({ error: "El nombre no puede superar 40 caracteres" }, { status: 400 })

  const validSports = ["football", "basketball", "baseball"]
  const cleanSport = sport && validSports.includes(sport) ? sport : null
  const cleanLeague = cleanSport && league?.trim() ? league.trim() : null

  let code: string = ""
  for (let i = 0; i < 5; i++) {
    const candidate = generateCode()
    const { data: existing } = await supabase.from("groups").select("id").eq("code", candidate).maybeSingle()
    if (!existing) { code = candidate; break }
  }
  if (!code) return NextResponse.json({ error: "No se pudo generar código único. Intenta de nuevo." }, { status: 500 })

  const { data: group, error: createErr } = await supabase
    .from("groups")
    .insert({ name: name.trim(), code, creator_id: userId, sport: cleanSport, league: cleanLeague })
    .select()
    .single()

  if (createErr || !group) return NextResponse.json({ error: createErr?.message || "Error al crear grupo" }, { status: 500 })

  await supabase.from("group_members").insert({ group_id: group.id, user_id: userId, role: "admin" })
  await supabase.from("group_wallets").insert({ group_id: group.id, user_id: userId, balance: 0 })

  return NextResponse.json({ success: true, group: { ...group, my_balance: 0, member_count: 1, my_role: "admin" } })
}
