"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { useMode } from "@/components/mode-provider"
import { useAuth } from "@/components/providers"

export function ModeToggle() {
  const { mode, setMode } = useMode()
  const { user } = useAuth()
  const [showConfirm, setShowConfirm] = useState(false)

  if (!user) return null

  function handleToggle() {
    if (mode === "fantasy") {
      setShowConfirm(true)
    } else {
      setMode("fantasy")
    }
  }

  function confirmSwitchToReal() {
    setMode("real")
    setShowConfirm(false)
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleToggle}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 focus:outline-none
            ${mode === "real" ? "bg-amber-500" : "bg-blue-600"}
          `}
          title={mode === "fantasy" ? "Cambiar a Modo Real (IBC)" : "Cambiar a Modo Fantasy"}
        >
          <span className={`
            inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-300
            ${mode === "real" ? "translate-x-6" : "translate-x-1"}
          `} />
        </button>
        <span className={`text-xs font-semibold ${mode === "real" ? "text-amber-400" : "text-blue-400"}`}>
          {mode === "real" ? "Real" : "Fantasy"}
        </span>
      </div>

      {showConfirm && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-bold mb-2">Cambiar a Modo Real</h2>
            <p className="text-sm text-muted-foreground mb-4">
              En Modo Real apostas con <span className="text-amber-400 font-semibold">iBY Coins (IBC)</span> — moneda con valor real (1 IBC = $1 USD). Las apuestas se descuentan de tu saldo IBC.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2 rounded-md border border-border text-sm hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmSwitchToReal}
                className="flex-1 px-4 py-2 rounded-md bg-amber-500 text-black font-semibold text-sm hover:bg-amber-400"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
