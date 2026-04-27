"use client"

import { useState, createContext, useContext, type ReactNode } from "react"

type ToastType = "success" | "error" | "info" | "notification"

interface Toast {
  id: string
  message: string
  body?: string
  type: ToastType
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, body?: string) => void
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

const TOAST_CONFIG: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "bg-green-600", border: "border-green-500", icon: "✓" },
  error:   { bg: "bg-red-600",   border: "border-red-500",   icon: "✕" },
  info:    { bg: "bg-blue-600",  border: "border-blue-500",  icon: "ℹ" },
  notification: {
    bg: "bg-zinc-900",
    border: "border-l-4 border-l-violet-500 border border-zinc-700",
    icon: "🔔",
  },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = (message: string, type: ToastType = "success", body?: string) => {
    const id = Math.random().toString(36).substring(7)
    setToasts((prev) => [...prev, { id, message, body, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, type === "notification" ? 6000 : 4000)
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => {
          const cfg = TOAST_CONFIG[toast.type]
          return (
            <div
              key={toast.id}
              className={`flex items-start gap-3 rounded-lg shadow-xl text-white min-w-[300px] max-w-[360px] animate-slide-in overflow-hidden ${
                toast.type === "notification"
                  ? `${cfg.bg} ${cfg.border} px-4 py-3`
                  : `${cfg.bg} px-4 py-3`
              }`}
            >
              <span className={`text-lg leading-none mt-0.5 flex-shrink-0 ${toast.type === "notification" ? "text-violet-400" : ""}`}>
                {cfg.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`font-semibold leading-snug ${toast.type === "notification" ? "text-white" : ""}`}>
                  {toast.message}
                </div>
                {toast.body && (
                  <div className="text-sm text-zinc-300 mt-0.5 leading-snug">{toast.body}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
