import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const response = NextResponse.next()
  const ref = request.nextUrl.searchParams.get("ref")

  // Only set cookie if ref param present and cookie not already set
  if (ref && /^[a-zA-Z0-9_-]{6,16}$/.test(ref) && !request.cookies.has("iby_ref")) {
    response.cookies.set("iby_ref", ref, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    })
  }

  return response
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|favicon.ico).*)",
}
