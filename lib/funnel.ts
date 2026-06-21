import { createAdminSupabaseClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"

export async function logUserEvent(
  userId: string,
  eventType: string,
  metadata?: Record<string, unknown>,
  supabase?: SupabaseClient
): Promise<void> {
  try {
    const client = supabase ?? createAdminSupabaseClient()
    await client.from("user_funnel_events").insert({
      user_id: userId,
      event_type: eventType,
      metadata: metadata ?? null,
    })
  } catch {
    // Never throw — funnel tracking must never break business flows
  }
}
