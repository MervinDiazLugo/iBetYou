import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase"

function parseCookieHeader(cookieHeader: string): Record<string, string> {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const separatorIndex = item.indexOf("=")
      if (separatorIndex === -1) return acc
      const key = item.slice(0, separatorIndex)
      const value = item.slice(separatorIndex + 1)
      acc[key] = value
      return acc
    }, {} as Record<string, string>)
}

function decodeCookieValue(rawValue: string): string {
  try {
    return decodeURIComponent(rawValue)
  } catch {
    return rawValue
  }
}

function extractTokenFromSessionPayload(payloadRaw: string): string | null {
  const payload = payloadRaw.replace(/^"|"$/g, "")

  const parsePayload = (raw: string) => {
    try {
      return JSON.parse(raw) as any
    } catch {
      return null
    }
  }

  let parsed: any = null
  if (payload.startsWith("base64-")) {
    try {
      const decoded = Buffer.from(payload.slice(7), "base64").toString("utf-8")
      parsed = parsePayload(decoded)
    } catch {
      parsed = null
    }
  } else {
    parsed = parsePayload(payload)
  }

  if (!parsed) return null

  if (typeof parsed?.access_token === "string") return parsed.access_token
  if (typeof parsed?.currentSession?.access_token === "string") return parsed.currentSession.access_token
  if (typeof parsed?.session?.access_token === "string") return parsed.session.access_token
  if (Array.isArray(parsed) && typeof parsed[0]?.access_token === "string") return parsed[0].access_token

  return null
}

function extractSupabaseAccessTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null

  const cookies = parseCookieHeader(cookieHeader)
  const authCookieNames = Object.keys(cookies).filter((name) => /^sb-.*-auth-token(?:\.\d+)?$/.test(name))

  if (authCookieNames.length === 0) return null

  const exactCookie = authCookieNames.find((name) => !name.includes("."))
  if (exactCookie) {
    const token = extractTokenFromSessionPayload(decodeCookieValue(cookies[exactCookie]))
    if (token) return token
  }

  const chunkedNames = authCookieNames
    .map((name) => {
      const match = name.match(/^(sb-.*-auth-token)\.(\d+)$/)
      if (!match) return null
      return { base: match[1], index: Number(match[2]), full: name }
    })
    .filter((item): item is { base: string; index: number; full: string } => item !== null)

  if (chunkedNames.length > 0) {
    const baseName = chunkedNames[0].base
    const combined = chunkedNames
      .filter((item) => item.base === baseName)
      .sort((a, b) => a.index - b.index)
      .map((item) => cookies[item.full] || "")
      .join("")

    if (combined) {
      const token = extractTokenFromSessionPayload(decodeCookieValue(combined))
      if (token) return token
    }
  }

  for (const name of authCookieNames) {
    const token = extractTokenFromSessionPayload(decodeCookieValue(cookies[name]))
    if (token) return token
  }

  return null
}

function extractSupabaseAccessTokenFromRequestCookies(request: NextRequest): string | null {
  const allCookies = request.cookies.getAll()
  if (!allCookies || allCookies.length === 0) return null

  const cookieMap = allCookies.reduce((acc, cookie) => {
    acc[cookie.name] = cookie.value
    return acc
  }, {} as Record<string, string>)

  const authCookieNames = Object.keys(cookieMap).filter((name) => /^sb-.*-auth-token(?:\.\d+)?$/.test(name))
  if (authCookieNames.length === 0) return null

  const exactCookie = authCookieNames.find((name) => !name.includes("."))
  if (exactCookie) {
    const token = extractTokenFromSessionPayload(decodeCookieValue(cookieMap[exactCookie]))
    if (token) return token
  }

  const chunkedNames = authCookieNames
    .map((name) => {
      const match = name.match(/^(sb-.*-auth-token)\.(\d+)$/)
      if (!match) return null
      return { base: match[1], index: Number(match[2]), full: name }
    })
    .filter((item): item is { base: string; index: number; full: string } => item !== null)

  if (chunkedNames.length > 0) {
    const baseName = chunkedNames[0].base
    const combined = chunkedNames
      .filter((item) => item.base === baseName)
      .sort((a, b) => a.index - b.index)
      .map((item) => cookieMap[item.full] || "")
      .join("")

    if (combined) {
      const token = extractTokenFromSessionPayload(decodeCookieValue(combined))
      if (token) return token
    }
  }

  for (const name of authCookieNames) {
    const token = extractTokenFromSessionPayload(decodeCookieValue(cookieMap[name]))
    if (token) return token
  }

  return null
}

export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get("authorization")
  let headerToken: string | null = null

  if (authHeader?.startsWith("Bearer ")) {
    headerToken = authHeader.slice(7)
  }

  const cookieToken = extractSupabaseAccessTokenFromRequestCookies(request)
    || extractSupabaseAccessTokenFromCookie(request.headers.get("cookie"))
  const candidateTokens = [headerToken, cookieToken].filter((token): token is string => !!token)

  if (candidateTokens.length === 0) return null

  const serverSupabase = createServerSupabaseClient()

  for (const token of candidateTokens) {
    const {
      data: { user },
      error,
    } = await serverSupabase.auth.getUser(token)

    if (!error && user) {
      return user.id
    }
  }

  return null
}

export async function requireBackofficeAdmin(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request)
  if (!userId) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const adminSupabase = createAdminSupabaseClient()
  const { data: profile, error } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()

  if (error || profile?.role !== "backoffice_admin") {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }
  }

  return {
    authorized: true,
    userId,
  }
}