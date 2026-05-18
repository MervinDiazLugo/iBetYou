"use client"

import { createContext, useContext, useEffect, useState } from "react"
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

  useEffect(() => {
    const stored = getStoredMode()
    setModeState(stored)
    document.documentElement.setAttribute("data-mode", stored)
  }, [])

  function setMode(next: BetMode) {
    setModeState(next)
    storeMode(next)
    document.documentElement.setAttribute("data-mode", next)
  }

  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>
}

export function useMode() {
  return useContext(ModeContext)
}
