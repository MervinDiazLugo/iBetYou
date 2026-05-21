"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { useMode } from "@/components/mode-provider"
import { useAuth } from "@/components/providers"
import { useCountryAccess } from "@/hooks/use-country-access"

export function ModeToggle() {
  const { mode, setMode } = useMode()
  const { user } = useAuth()
  const { canUseRealMoney } = useCountryAccess()
  const [showConfirm, setShowConfirm] = useState(false)
  const [showBlocked, setShowBlocked] = useState(false)

  // Force back to fantasy if country access is denied while in real mode
  useEffect(() => {
    if (canUseRealMoney === false && mode === "real") {
      setMode("fantasy")
    }
  }, [canUseRealMoney, mode])

  if (!user) return null

  // null = still loading → treat as locked to prevent flash
  const locked = canUseRealMoney !== true

  function handleToggle() {
    if (mode === "real") {
      setMode("fantasy")
      return
    }
    if (locked) {
      if (canUseRealMoney === false) setShowBlocked(true)
      return
    }
    setShowConfirm(true)
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleToggle}
          disabled={canUseRealMoney === null}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 focus:outline-none
            ${locked ? "bg-muted cursor-not-allowed opacity-60" : mode === "real" ? "bg-amber-500" : "bg-blue-600"}
          `}
          title={
            canUseRealMoney === null ? "Cargando..."
            : locked ? "Modo Real no disponible en tu país"
            : mode === "fantasy" ? "Cambiar a Modo Real (iBY)"
            : "Cambiar a Modo Fantasy"
          }
        >
          <span className={`
            inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-300
            ${mode === "real" && !locked ? "translate-x-6" : "translate-x-1"}
          `} />
        </button>
        <span className={`text-xs font-semibold ${
          locked ? "text-muted-foreground"
          : mode === "real" ? "text-amber-400"
          : "text-blue-400"
        }`}>
          {locked ? "Fantasy" : mode === "real" ? "Real" : "Fantasy"}
        </span>
      </div>

      {showConfirm && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-bold mb-2">Cambiar a Modo Real</h2>
            <p className="text-sm text-muted-foreground mb-4">
              En Modo Real apostas con <span className="text-amber-400 font-semibold">iBY Coins (iBY)</span> — moneda con valor real (1 iBY = $1 USD). Las apuestas se descuentan de tu saldo iBY.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2 rounded-md border border-border text-sm hover:bg-secondary">
                Cancelar
              </button>
              <button type="button" onClick={() => { setMode("real"); setShowConfirm(false) }}
                className="flex-1 px-4 py-2 rounded-md bg-amber-500 text-black font-semibold text-sm hover:bg-amber-400">
                Confirmar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showBlocked && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-bold mb-2">Modo Real no disponible</h2>
            <p className="text-sm text-muted-foreground mb-4">
              El Modo Real con <span className="text-amber-400 font-semibold">iBY Coins (iBY)</span> aún no está habilitado en tu país. Por ahora podés disfrutar del Modo Fantasy sin límites.
            </p>
            <button type="button" onClick={() => setShowBlocked(false)}
              className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90">
              Entendido
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
