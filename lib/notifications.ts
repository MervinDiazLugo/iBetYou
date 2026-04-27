import { createAdminSupabaseClient } from "@/lib/supabase"

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

export async function createNotification(n: NotificationInput) {
  try {
    const supabase = createAdminSupabaseClient()
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

export async function createNotifications(notifications: NotificationInput[]) {
  if (notifications.length === 0) return
  try {
    const supabase = createAdminSupabaseClient()
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
