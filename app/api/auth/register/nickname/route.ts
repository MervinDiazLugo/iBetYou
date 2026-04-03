import { createAdminSupabaseClient } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedUserId } from "@/lib/server-auth"

export async function POST(request: NextRequest) {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(request)
    if (!authenticatedUserId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { userId, nickname } = await request.json()

    if (userId && userId !== authenticatedUserId) {
      return NextResponse.json(
        { error: "Unauthorized user scope" },
        { status: 403 }
      )
    }

    const effectiveUserId = authenticatedUserId

    if (!nickname) {
      return NextResponse.json(
        { error: "nickname is required" },
        { status: 400 }
      )
    }

    const supabase = createAdminSupabaseClient()
    let finalNickname = nickname.trim()
    let attemptNumber = 0
    let success = false

    // Try to use the requested nickname, fall back to numbered versions if taken
    while (attemptNumber < 100 && !success) {
      try {
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ nickname: finalNickname })
          .eq("id", effectiveUserId)

        if (updateError) {
          // If unique constraint error, try with number
          if (updateError.message.includes("unique")) {
            attemptNumber++
            finalNickname = `${nickname.trim()}${attemptNumber}`
          } else {
            throw updateError
          }
        } else {
          success = true
        }
      } catch (err) {
        return NextResponse.json(
          { error: "Error saving nickname" },
          { status: 400 }
        )
      }
    }

    if (!success) {
      return NextResponse.json(
        { error: "Could not find available nickname" },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      nickname: finalNickname,
    })
  } catch (error) {
    console.error("Register nickname error:", error)
    return NextResponse.json(
      { error: "Failed to save nickname" },
      { status: 500 }
    )
  }
}
