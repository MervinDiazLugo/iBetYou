"use client"

import { useState, useRef, useEffect } from "react"
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react"
import { calcDirectOdds } from "@/lib/house-odds"
import Image from "next/image"
import type { Event } from "@/types"

const sportIcon: Record<string, string> = { football: "⚽", basketball: "🏀", baseball: "⚾" }

interface QuickBetRibbonProps {
  events: Event[]
  onSelectOdds: (event: Event, selection: "home" | "draw" | "away") => void
}

export function QuickBetRibbon({ events, onSelectOdds }: QuickBetRibbonProps) {
  const [expanded, setExpanded] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const eventsWithOdds = events
    .filter((e) => (e.metadata as any)?.predictions?.percent)
    .map((e) => {
      const percent = (e.metadata as any).predictions.percent
      const odds = calcDirectOdds(percent)
      return { event: e, odds }
    })
    .filter((e) => e.odds !== null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function check() {
      if (!el) return
      setCanScrollLeft(el.scrollLeft > 4)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
    }
    check()
    el.addEventListener("scroll", check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => { el.removeEventListener("scroll", check); ro.disconnect() }
  }, [eventsWithOdds.length])

  if (eventsWithOdds.length === 0) return null

  function scroll(dir: "left" | "right") {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -280 : 280, behavior: "smooth" })
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 transition-all duration-300 ease-out">
      {/* Collapsed bar */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-2 py-2 bg-gray-900/95 backdrop-blur border-t border-gray-700/50 hover:bg-gray-800/95 transition-colors cursor-pointer"
        >
          <span className="text-xs font-medium text-blue-400">⚡ Apuesta rápida</span>
          <span className="text-[10px] text-gray-500">{eventsWithOdds.length} eventos</span>
          <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
        </button>
      )}

      {/* Expanded ribbon */}
      {expanded && (
        <div className="bg-gray-900/95 backdrop-blur border-t border-gray-700/50">
          <div className="flex items-center justify-between px-4 py-1.5">
            <span className="text-xs font-medium text-blue-400">⚡ Apuesta rápida vs la Casa</span>
            <button
              onClick={() => setExpanded(false)}
              className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              Ocultar
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>

          <div className="relative px-2 pb-3">
            {canScrollLeft && (
              <button
                onClick={() => scroll("left")}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-14 flex items-center justify-center bg-gray-900/90 border-r border-gray-700/50 hover:bg-gray-800 transition-colors rounded-r"
              >
                <ChevronLeft className="h-4 w-4 text-gray-400" />
              </button>
            )}

            <div
              ref={scrollRef}
              className="flex gap-2 overflow-x-auto scrollbar-hide scroll-smooth px-1"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {eventsWithOdds.map(({ event, odds }) => {
                if (!odds) return null
                const isFootball = event.sport === "football"
                return (
                  <div
                    key={event.id}
                    className="flex-shrink-0 w-[260px] bg-gray-800/80 border border-gray-700/50 rounded-lg p-2.5 hover:border-gray-600/50 transition-colors"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs">{sportIcon[event.sport] || "🏆"}</span>
                        <span className="text-[10px] text-gray-500 truncate max-w-[120px]">{event.league}</span>
                      </div>
                      <span className="text-[10px] text-gray-500 flex-shrink-0">
                        {new Date(event.start_time).toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
                      </span>
                    </div>

                    {/* Teams */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        {event.home_logo && (
                          <Image src={event.home_logo} alt="" width={16} height={16} className="object-contain flex-shrink-0" unoptimized />
                        )}
                        <span className="text-[11px] font-medium text-white truncate">{event.home_team}</span>
                      </div>
                      <span className="text-[10px] text-gray-600">vs</span>
                      <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
                        <span className="text-[11px] font-medium text-white truncate text-right">{event.away_team}</span>
                        {event.away_logo && (
                          <Image src={event.away_logo} alt="" width={16} height={16} className="object-contain flex-shrink-0" unoptimized />
                        )}
                      </div>
                    </div>

                    {/* Odds buttons */}
                    <div className="flex gap-1">
                      <button
                        onClick={() => onSelectOdds(event, "home")}
                        className="flex-1 bg-gray-900 hover:bg-blue-900/40 border border-gray-700/50 hover:border-blue-500/40 rounded px-1.5 py-1 transition-colors text-center"
                      >
                        <div className="text-[9px] text-gray-500 truncate">{event.home_team.split(" ").slice(-1)[0]}</div>
                        <div className="text-xs font-bold text-blue-400">{odds.home.toFixed(2)}</div>
                      </button>
                      {isFootball && odds.draw !== undefined && (
                        <button
                          onClick={() => onSelectOdds(event, "draw")}
                          className="flex-1 bg-gray-900 hover:bg-gray-700/60 border border-gray-700/50 hover:border-gray-500/40 rounded px-1.5 py-1 transition-colors text-center"
                        >
                          <div className="text-[9px] text-gray-500">Empate</div>
                          <div className="text-xs font-bold text-gray-300">{odds.draw.toFixed(2)}</div>
                        </button>
                      )}
                      <button
                        onClick={() => onSelectOdds(event, "away")}
                        className="flex-1 bg-gray-900 hover:bg-orange-900/40 border border-gray-700/50 hover:border-orange-500/40 rounded px-1.5 py-1 transition-colors text-center"
                      >
                        <div className="text-[9px] text-gray-500 truncate">{event.away_team.split(" ").slice(-1)[0]}</div>
                        <div className="text-xs font-bold text-orange-400">{odds.away.toFixed(2)}</div>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {canScrollRight && (
              <button
                onClick={() => scroll("right")}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-14 flex items-center justify-center bg-gray-900/90 border-l border-gray-700/50 hover:bg-gray-800 transition-colors rounded-l"
              >
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
