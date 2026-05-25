"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Wallet, User, LogOut, Menu, X, Coins, Plus, PauseCircle } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { useAuth } from "@/components/providers"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { NotificationBell } from "@/components/notification-bell"
import { ModeToggle } from "@/components/mode-toggle"
import { useMode } from "@/components/mode-provider"
import { useCountryAccess } from "@/hooks/use-country-access"
import { formatCurrency } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/", label: "Marketplace" },
  { href: "/my-bets", label: "Mis Apuestas" },
  { href: "/groups", label: "Grupos" },
  { href: "/leaderboard", label: "Leaderboard" },
]

export function Navbar() {
  const pathname = usePathname()
  const { user, loading: authLoading, signOut } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [showSelfExcludeConfirm, setShowSelfExcludeConfirm] = useState(false)
  const [selfExcludeLoading, setSelfExcludeLoading] = useState(false)
  const [balance, setBalance] = useState({ fantasy: 0, real: 0 })
  const [ibcBalance, setIbcBalance] = useState(0)
  const [menuNickname, setMenuNickname] = useState("")
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)
  const supabase = createBrowserSupabaseClient()
  const { mode } = useMode()
  const { canUseRealMoney } = useCountryAccess()

  const displayName =
    menuNickname?.trim() || user?.nickname?.trim() || user?.email?.split("@")[0] || ""

  const currentBalance = mode === "real" ? ibcBalance : balance.fantasy

  async function loadWalletData(userId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: HeadersInit = {}
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`
      setSessionToken(session.access_token)
    }
    const [res, ibcRes] = await Promise.all([
      fetch(`/api/wallet?user_id=${userId}`, { headers }),
      fetch("/api/iby/wallet", { headers }),
    ])
    if (res.ok) {
      const data = await res.json()
      setMenuNickname(data.user?.nickname || "")
      if (data.wallet) setBalance({ fantasy: data.wallet.balance_fantasy, real: data.wallet.balance_real })
    }
    if (ibcRes.ok) {
      const d = await ibcRes.json()
      setIbcBalance(Number(d.wallet?.balance || 0) - Number(d.wallet?.balance_blocked || 0))
    }
  }

  useEffect(() => {
    if (!user) { setMenuNickname(""); setBalance({ fantasy: 0, real: 0 }); setIbcBalance(0); return }
    setMenuNickname("")
    loadWalletData(user.id)
  }, [user?.id])

  useEffect(() => {
    if (userMenuOpen && user?.id) loadWalletData(user.id)
  }, [userMenuOpen, user?.id])

  useEffect(() => {
    if (!user?.id) return
    const handler = () => loadWalletData(user.id)
    window.addEventListener("wallet:updated", handler)
    return () => window.removeEventListener("wallet:updated", handler)
  }, [user?.id])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  async function handleSelfExclude() {
    setSelfExcludeLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch("/api/user/self-exclude", {
        method: "POST",
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      if (res.ok) {
        await signOut()
      }
    } finally {
      setSelfExcludeLoading(false)
      setShowSelfExcludeConfirm(false)
    }
  }

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false) }, [pathname])

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  return (
    <>
      <nav className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="container mx-auto px-4">
          <div className="flex h-14 items-stretch justify-between gap-2">

            {/* Left: Logo */}
            <div className="flex items-center gap-3 shrink-0">
              <Link href="/" className="flex items-center">
                <span className="px-2.5 py-1 rounded bg-primary text-primary-foreground font-extrabold tracking-tight text-lg leading-none">
                  iBetYou
                </span>
              </Link>
            </div>

            {/* Center: Nav tabs — desktop */}
            <div className="hidden md:flex items-stretch flex-1 justify-center gap-0">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center px-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive(item.href)
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              {user && (
                <Link
                  href="/?create=true"
                  className="flex items-center px-4 text-sm font-semibold border-b-2 border-transparent text-green-500 hover:text-green-400 hover:border-green-500/40 transition-colors whitespace-nowrap gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Crear Apuesta
                </Link>
              )}
            </div>

            {/* Right: balance + controls + user */}
            <div className="flex items-center gap-2 shrink-0">
              {!authLoading && user && (
                <>
                  {/* Balance pill — desktop (only show top-up link if real money enabled) */}
                  <Link
                    href={canUseRealMoney ? "/top-up" : "#"}
                    className="hidden md:flex items-center gap-2 rounded-lg border border-border bg-secondary/50 hover:bg-secondary px-3 py-1.5 transition-colors"
                  >
                    {mode === "real"
                      ? <Coins className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      : <Wallet className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    }
                    <span className="text-sm font-bold tabular-nums">
                      {formatCurrency(currentBalance)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {mode === "real" ? "iBY" : "Fantasy"}
                    </span>
                    <span className="ml-0.5 text-[10px] font-bold bg-primary/20 text-primary px-1 py-0.5 rounded leading-none">+</span>
                  </Link>

                  <ModeToggle />
                  <span className="hidden md:flex">
                    <NotificationBell userId={user.id} sessionToken={sessionToken} />
                  </span>

                  {/* User dropdown */}
                  <div className="relative" ref={userMenuRef}>
                    <button
                      type="button"
                      onClick={() => setUserMenuOpen((prev) => !prev)}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 hover:bg-secondary transition-colors"
                    >
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                        {displayName.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="hidden lg:block text-sm font-medium max-w-[120px] truncate">
                        {displayName}
                      </span>
                    </button>

                    {userMenuOpen && (
                      <div className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden">
                        {/* User header */}
                        <div className="p-4 bg-secondary/30 border-b border-border">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-base font-bold text-primary shrink-0">
                              {displayName.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">{displayName}</div>
                              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                            </div>
                          </div>
                        </div>

                        {/* Balances */}
                        <div className={`p-3 border-b border-border grid gap-2 ${canUseRealMoney ? "grid-cols-2" : "grid-cols-1"}`}>
                          <div className={`rounded-lg p-2.5 border ${mode === "fantasy" ? "bg-blue-500/10 border-blue-500/30" : "bg-secondary/40 border-border/50"}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <Wallet className="h-3 w-3 text-blue-400" />
                              <span className="text-[10px] text-muted-foreground">Fantasy</span>
                              {mode === "fantasy" && <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 rounded leading-none py-0.5">activo</span>}
                            </div>
                            <div className="font-bold text-sm">{formatCurrency(balance.fantasy)}</div>
                          </div>
                          {canUseRealMoney && (
                            <div className={`rounded-lg p-2.5 border ${mode === "real" ? "bg-amber-500/10 border-amber-500/30" : "bg-secondary/40 border-border/50"}`}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <Coins className="h-3 w-3 text-amber-400" />
                                <span className="text-[10px] text-muted-foreground">iBY</span>
                                {mode === "real" && <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1 rounded leading-none py-0.5">activo</span>}
                              </div>
                              <div className="font-bold text-sm text-amber-400">{formatCurrency(ibcBalance)}</div>
                            </div>
                          )}
                        </div>

                        {/* Nav links */}
                        <div className="p-2 space-y-0.5">
                          {[
                            { href: "/profile", label: "Mi Perfil" },
                            { href: "/balance", label: "Balance de Jugadas" },
                            ...(canUseRealMoney ? [
                              { href: "/top-up", label: "Recargas iBY" },
                              { href: "/withdrawals", label: "Retiros iBY" },
                            ] : []),
                            { href: "/my-referrals", label: "Mis Referidos", accent: true },
                            { href: "/como-jugar", label: "Cómo Jugar" },
                          ].map((item) => (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => setUserMenuOpen(false)}
                              className={`block px-3 py-2 rounded-lg text-sm hover:bg-secondary transition-colors ${item.accent ? "text-amber-400" : ""}`}
                            >
                              {item.label}
                            </Link>
                          ))}
                        </div>

                        <div className="border-t border-border p-2 space-y-0.5">
                          <button
                            type="button"
                            onClick={() => { setUserMenuOpen(false); setShowSelfExcludeConfirm(true) }}
                            className="w-full px-3 py-2 rounded-lg text-sm text-left hover:bg-red-500/10 flex items-center gap-2 text-red-400 transition-colors"
                          >
                            <PauseCircle className="h-4 w-4" />
                            Tiempo Fuera (72h)
                          </button>
                          <button
                            type="button"
                            onClick={signOut}
                            className="w-full px-3 py-2 rounded-lg text-sm text-left hover:bg-secondary flex items-center gap-2 text-muted-foreground transition-colors"
                          >
                            <LogOut className="h-4 w-4" />
                            Cerrar sesión
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {!authLoading && !user && (
                <div className="hidden md:flex items-center gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/login">Iniciar Sesión</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/register">Registrarse</Link>
                  </Button>
                </div>
              )}

              {/* Mobile: notification + hamburger */}
              {!authLoading && user && (
                <div className="md:hidden">
                  <NotificationBell userId={user.id} sessionToken={sessionToken} />
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-9 w-9"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile drawer overlay */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute right-0 top-0 h-full w-72 bg-card shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="px-2 py-0.5 rounded bg-primary text-primary-foreground font-extrabold text-base">iBetYou</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            {/* User info + balance (if logged in) */}
            {user && (
              <div className="px-4 py-3 border-b border-border bg-secondary/20">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary text-sm shrink-0">
                    {displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{displayName}</div>
                    <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                  </div>
                </div>
                <div className={`grid gap-2 ${canUseRealMoney ? "grid-cols-2" : "grid-cols-1"}`}>
                  <div className="rounded-lg bg-secondary/60 px-2.5 py-2 border border-border/60">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3 text-blue-400" /> Fantasy</div>
                    <div className="font-bold text-sm mt-0.5">{formatCurrency(balance.fantasy)}</div>
                  </div>
                  {canUseRealMoney && (
                    <div className="rounded-lg bg-secondary/60 px-2.5 py-2 border border-border/60">
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Coins className="h-3 w-3 text-amber-400" /> iBY</div>
                      <div className="font-bold text-sm text-amber-400 mt-0.5">{formatCurrency(ibcBalance)}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Nav links */}
            <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.href)
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-secondary text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              ))}

              {user && (
                <>
                  <Link href="/?create=true" className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-green-500 hover:bg-green-500/10 transition-colors">
                    <Plus className="h-4 w-4" /> Crear Apuesta
                  </Link>
                  <div className="pt-2 border-t border-border mt-2 space-y-0.5">
                    {[
                      { href: "/profile", label: "Mi Perfil" },
                      { href: "/balance", label: "Balance de Jugadas" },
                      ...(canUseRealMoney ? [
                        { href: "/top-up", label: "Recargas iBY" },
                        { href: "/withdrawals", label: "Retiros iBY" },
                      ] : []),
                      { href: "/my-referrals", label: "Mis Referidos", accent: true },
                      { href: "/como-jugar", label: "Cómo Jugar" },
                    ].map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`block px-3 py-2.5 rounded-lg text-sm hover:bg-secondary transition-colors ${item.accent ? "text-amber-400" : "text-muted-foreground"}`}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}

              {!user && !authLoading && (
                <div className="pt-3 space-y-2">
                  <Button className="w-full" asChild>
                    <Link href="/register">Registrarse</Link>
                  </Button>
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/login">Iniciar Sesión</Link>
                  </Button>
                </div>
              )}
            </div>

            {/* Sign out + tiempo fuera */}
            {user && (
              <div className="border-t border-border p-3 space-y-1">
                <button
                  type="button"
                  onClick={() => { setMobileMenuOpen(false); setShowSelfExcludeConfirm(true) }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <PauseCircle className="h-4 w-4" /> Tiempo Fuera (72h)
                </button>
                <button
                  type="button"
                  onClick={signOut}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-secondary transition-colors"
                >
                  <LogOut className="h-4 w-4" /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Tiempo fuera confirmation modal */}
      {showSelfExcludeConfirm && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                <PauseCircle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h2 className="font-bold text-base">Tiempo Fuera</h2>
                <p className="text-xs text-muted-foreground">Auto-exclusión temporal</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Tu cuenta quedará <span className="text-foreground font-medium">bloqueada por 72 horas</span>. No podrás iniciar sesión ni realizar apuestas durante ese tiempo.
            </p>
            <p className="text-xs text-muted-foreground">Esta acción no se puede deshacer. El acceso se restaura automáticamente después de 72 horas.</p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowSelfExcludeConfirm(false)}
                disabled={selfExcludeLoading}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSelfExclude}
                disabled={selfExcludeLoading}
                className="flex-1 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {selfExcludeLoading ? "Procesando..." : "Confirmar pausa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
