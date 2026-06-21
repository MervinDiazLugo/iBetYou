"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react"
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

type ShutterPhase = "closing" | "opening" | null

const SHUTTER_DURATION = 360

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<BetMode>("fantasy")
  const [shutter, setShutter] = useState<ShutterPhase>(null)
  const animating = useRef(false)

  useEffect(() => {
    const stored = getStoredMode()
    setModeState(stored)
    document.documentElement.setAttribute("data-mode", stored)
  }, [])

  const setMode = useCallback((next: BetMode) => {
    if (animating.current) return
    animating.current = true

    // Phase 1: close shutter (iris contracts to black)
    document.documentElement.classList.add("mode-switching")
    setShutter("closing")

    setTimeout(() => {
      // Swap theme while everything is black
      setModeState(next)
      storeMode(next)
      document.documentElement.setAttribute("data-mode", next)
      setShutter("opening")

      setTimeout(() => {
        setShutter(null)
        document.documentElement.classList.remove("mode-switching")
        animating.current = false
      }, SHUTTER_DURATION)
    }, SHUTTER_DURATION)
  }, [])

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
      {shutter && (
        <div
          key={shutter}
          className={`shutter-overlay ${shutter === "closing" ? "iris-close" : "iris-open"}`}
        />
      )}
    </ModeContext.Provider>
  )
}

export function useMode() {
  return useContext(ModeContext)
}
