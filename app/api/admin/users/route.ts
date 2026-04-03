import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase"
import { requireBackofficeAdmin } from "@/lib/server-auth"

type UserRole = "app_user" | "backoffice_admin"

export async function GET(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()
  const { searchParams } = new URL(request.url)
  const role = searchParams.get("role")
  const limit = parseInt(searchParams.get("limit") || "200")

  try {
    let query = supabase
      .from("profiles")
      .select("id, nickname, avatar_url, role, is_banned, betting_blocked_until, false_claim_count, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (role && (role === "app_user" || role === "backoffice_admin")) {
      query = query.eq("role", role)
    }

    const { data: profiles, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const users = profiles || []

    // Auto-clear false_claim_count when betting block has expired
    const now = new Date()
    const toClean = users.filter(
      (u) =>
        u.betting_blocked_until &&
        new Date(u.betting_blocked_until) < now &&
        (u.false_claim_count ?? 0) > 0
    )
    if (toClean.length > 0) {
      await supabase
        .from("profiles")
        .update({ false_claim_count: 0, betting_blocked_until: null })
        .in("id", toClean.map((u) => u.id))
      toClean.forEach((u) => {
        u.false_claim_count = 0
        u.betting_blocked_until = null
      })
    }

    return NextResponse.json({ users })
  } catch (error: unknown) {
    console.error("Admin users GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBackofficeAdmin(request)
  if (!auth.authorized) {
    return auth.response
  }

  const supabase = createAdminSupabaseClient()

  try {
    const body = await request.json()
    const {
      user_id,
      action,
      role,
      email,
      password,
      nickname,
    } = body as {
      user_id?: string
      action?: "ban" | "unban" | "set_role" | "promote_by_email" | "create_admin" | "delete"
      role?: UserRole
      email?: string
      password?: string
      nickname?: string
    }

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 })
    }

    if (action === "create_admin") {
      if (!email || !password) {
        return NextResponse.json({ error: "email and password are required" }, { status: 400 })
      }

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (createErr || !created?.user) {
        return NextResponse.json({ error: createErr?.message || "Could not create user" }, { status: 500 })
      }

      const userId = created.user.id
      await new Promise((r) => setTimeout(r, 1000))

      const updates: Record<string, unknown> = { role: "backoffice_admin" }
      if (nickname) updates.nickname = nickname

      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", userId)
        .select("id, nickname, role")
        .single()

      if (profileErr) {
        return NextResponse.json({ error: profileErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, user: profile })
    }

    if (action === "delete") {
      if (!user_id) {
        return NextResponse.json({ error: "user_id is required" }, { status: 400 })
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user_id)
        .single()

      if (profile?.role !== "backoffice_admin") {
        return NextResponse.json({ error: "Only backoffice_admin accounts can be deleted" }, { status: 403 })
      }

      const { error: deleteErr } = await supabase.auth.admin.deleteUser(user_id)
      if (deleteErr) {
        return NextResponse.json({ error: deleteErr.message }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    if (action === "promote_by_email") {
      if (!email) {
        return NextResponse.json({ error: "email is required" }, { status: 400 })
      }

      const { data: usersRes, error: listError } = await supabase.auth.admin.listUsers()
      if (listError) {
        return NextResponse.json({ error: listError.message }, { status: 500 })
      }

      const target = (usersRes.users || []).find(
        (u) => (u.email || "").toLowerCase() === email.toLowerCase()
      )

      if (!target) {
        return NextResponse.json({ error: "User not found by email" }, { status: 404 })
      }

      const updates: Record<string, unknown> = {
        role: "backoffice_admin",
      }

      if (nickname) updates.nickname = nickname

      const { data: updatedProfile, error: updateError } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", target.id)
        .select("id, nickname, role, is_banned")
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, user: updatedProfile })
    }

    if (!user_id) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 })
    }

    if (action === "ban") {
      const { data, error } = await supabase
        .from("profiles")
        .update({ is_banned: true })
        .eq("id", user_id)
        .select("id, nickname, role, is_banned")
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, user: data })
    }

    if (action === "unban") {
      const { data, error } = await supabase
        .from("profiles")
        .update({ is_banned: false })
        .eq("id", user_id)
        .select("id, nickname, role, is_banned")
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, user: data })
    }

    if (action === "set_role") {
      if (!role || (role !== "app_user" && role !== "backoffice_admin")) {
        return NextResponse.json({ error: "valid role is required" }, { status: 400 })
      }

      const { data, error } = await supabase
        .from("profiles")
        .update({ role })
        .eq("id", user_id)
        .select("id, nickname, role, is_banned")
        .single()

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, user: data })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error: unknown) {
    console.error("Admin users PATCH error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
