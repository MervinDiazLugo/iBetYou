"use client"

import { useState, useCallback, createContext, useContext, type ReactNode } from "react"

export type ToastType = "success" | "error" | "info" | "notification" | "win"

interface Toast {
  id: string
  message: string
  body?: string
  type: ToastType
  duration: number
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, body?: string) => void
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

const TOAST_CONFIG: Record<ToastType, {
  gradient: string
  border: string
  icon: string
  iconBg: string
  duration: number
}> = {
  success: {
    gradient: "from-emerald-600 via-green-600 to-emerald-700",
    border: "border-emerald-400/30",
    icon: "✓",
    iconBg: "bg-emerald-500/30",
    duration: 5000,
  },
  error: {
    gradient: "from-red-600 via-red-600 to-red-700",
    border: "border-red-400/30",
    icon: "✕",
    iconBg: "bg-red-500/30",
    duration: 5000,
  },
  info: {
    gradient: "from-blue-600 via-blue-600 to-blue-700",
    border: "border-blue-400/30",
    icon: "ℹ",
    iconBg: "bg-blue-500/30",
    duration: 5000,
  },
  notification: {
    gradient: "from-zinc-800 via-zinc-800 to-zinc-900",
    border: "border-violet-500/40",
    icon: "🔔",
    iconBg: "bg-violet-500/20",
    duration: 7000,
  },
  win: {
    gradient: "from-amber-500 via-yellow-500 to-amber-600",
    border: "border-amber-300/40",
    icon: "🏆",
    iconBg: "bg-amber-300/20",
    duration: 7000,
  },
}

const PROGRESS_COLOR: Record<ToastType, string> = {
  success: "bg-emerald-300/60",
  error: "bg-red-300/60",
  info: "bg-blue-300/60",
  notification: "bg-violet-400/70",
  win: "bg-amber-200/70",
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const cfg = TOAST_CONFIG[toast.type]
  return (
    <div
      className={`toast-enter relative flex items-start gap-3 rounded-xl shadow-2xl text-white overflow-hidden
        min-w-[340px] max-w-[420px] border bg-gradient-to-br ${cfg.gradient} ${cfg.border}
        ${toast.type === "win" ? "ring-2 ring-amber-400/30" : ""}
      `}
    >
      {/* Progress bar */}
      <div
        className={`absolute bottom-0 left-0 h-[3px] ${PROGRESS_COLOR[toast.type]} rounded-b-xl`}
        style={{ animation: `toast-progress ${toast.duration}ms linear forwards` }}
      />

      <div className="flex items-start gap-3 px-4 py-3.5 w-full">
        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base ${cfg.iconBg}`}>
          {cfg.icon}
        </div>
        <div className="flex-1 min-w-0 pr-2">
          <div className={`font-bold leading-snug ${toast.type === "win" ? "text-amber-50 text-base" : "text-sm"}`}>
            {toast.message}
          </div>
          {toast.body && (
            <div className={`mt-0.5 leading-snug ${toast.type === "win" ? "text-amber-100/90 text-sm" : "text-xs text-white/80"}`}>
              {toast.body}
            </div>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 text-white/50 hover:text-white/90 transition-colors text-xs leading-none mt-0.5"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: ToastType = "success", body?: string) => {
    const cfg = TOAST_CONFIG[type]
    const id = Math.random().toString(36).substring(7)
    setToasts((prev) => [...prev, { id, message, body, type, duration: cfg.duration }])
    setTimeout(() => dismiss(id), cfg.duration)
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2.5 items-end">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
