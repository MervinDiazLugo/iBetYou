import { createAdminSupabaseClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"

export type NotificationType =
  | "bet_taken"
  | "result_reported"
  | "bet_resolved_win"
  | "bet_resolved_loss"
  | "bet_disputed"

interface NotificationInput {
  userId: string
  type: NotificationType
  title: string
  body: string
  betId?: string | null
}

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export async function createNotification(n: NotificationInput, client?: AdminClient) {
  try {
    const supabase = client ?? createAdminSupabaseClient()
    await supabase.from("notifications").insert({
      user_id: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      bet_id: n.betId || null,
    })
  } catch (e) {
    console.error("createNotification failed:", e)
  }
}

export async function createNotifications(notifications: NotificationInput[], client?: AdminClient) {
  if (notifications.length === 0) return
  try {
    const supabase = client ?? createAdminSupabaseClient()
    await supabase.from("notifications").insert(
      notifications.map((n) => ({
        user_id: n.userId,
        type: n.type,
        title: n.title,
        body: n.body,
        bet_id: n.betId || null,
      }))
    )
  } catch (e) {
    console.error("createNotifications failed:", e)
  }
}
