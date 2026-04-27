"use client"

import { useState, useEffect, useRef } from "react"
import { Bell } from "lucide-react"
import Link from "next/link"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"
import { formatDate } from "@/lib/utils"

interface Notification {
  id: string
  type: string
  title: string
  body: string
  bet_id: string | null
  read: boolean
  created_at: string
}

const TYPE_ICON: Record<string, string> = {
  bet_taken: "🤝",
  result_reported: "📋",
  bet_resolved_win: "🏆",
  bet_resolved_loss: "😔",
  bet_disputed: "⚖️",
}

interface Props {
  userId: string
  sessionToken: string | null
}

export function NotificationBell({ userId, sessionToken }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()
  const supabase = createBrowserSupabaseClient()

  const unreadCount = notifications.filter((n) => !n.read).length

  async function fetchNotifications() {
    const headers: HeadersInit = {}
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`
    const res = await fetch("/api/notifications", { headers }).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      setNotifications(data.notifications || [])
    }
  }

  async function markAllRead() {
    const headers: HeadersInit = { "Content-Type": "application/json" }
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`
    await fetch("/api/notifications", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ all: true }),
    })
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  // Initial load
  useEffect(() => {
    fetchNotifications()
  }, [userId])

  // Realtime: new notification arrives → add to list + show toast
  useEffect(() => {
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const notif = payload.new as Notification
          setNotifications((prev) => [notif, ...prev])
          showToast(notif.title, notif.type === "bet_resolved_win" ? "success" : "error")
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  // Mark all as read when dropdown opens
  useEffect(() => {
    if (open && unreadCount > 0) {
      markAllRead()
    }
  }, [open])

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative p-1.5 rounded-md hover:bg-secondary transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-lg border border-border bg-card shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="font-semibold text-sm">Notificaciones</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Marcar todas como leídas
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No hay notificaciones
              </div>
            ) : (
              notifications.map((n) => {
                const inner = (
                  <div className={`px-3 py-2.5 border-b border-border last:border-0 transition-colors ${!n.read ? "bg-primary/5" : "hover:bg-secondary/50"}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-base leading-none mt-0.5">{TYPE_ICON[n.type] || "🔔"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium leading-tight">{n.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.body}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDate(n.created_at)}
                        </div>
                      </div>
                      {!n.read && (
                        <span className="h-2 w-2 rounded-full bg-primary mt-1 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                )

                return n.bet_id ? (
                  <Link key={n.id} href={`/bet/${n.bet_id}`} onClick={() => setOpen(false)}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
