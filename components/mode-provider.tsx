"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { BetMode } from "@/lib/mode"
import { getStoredMode, storeMode } from "@/lib/mode"

interface ModeContextValue {
  mode: BetMode
  setMode: (mode: BetMode) => void
}

const ModeContext = createContext<ModeContextValue>({
  mode: "fantasy",
  setMode: () => {},
})

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<BetMode>("fantasy")
  const [flash, setFlash] = useState<{ color: string; key: number } | null>(null)
  const flashKey = useRef(0)

  useEffect(() => {
    const stored = getStoredMode()
    setModeState(stored)
    document.documentElement.setAttribute("data-mode", stored)
  }, [])

  function setMode(next: BetMode) {
    setModeState(next)
    storeMode(next)
    document.documentElement.setAttribute("data-mode", next)
    flashKey.current += 1
    const color = next === "real" ? "rgba(245,158,11,0.18)" : "rgba(59,130,246,0.18)"
    setFlash({ color, key: flashKey.current })
    setTimeout(() => setFlash(null), 600)
  }

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
      {flash && (
        <div
          key={flash.key}
          className="mode-transition-overlay fixed inset-0 z-[9999]"
          style={{ backgroundColor: flash.color }}
        />
      )}
    </ModeContext.Provider>
  )
}

export function useMode() {
  return useContext(ModeContext)
}
