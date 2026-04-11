"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Wallet, User, LogOut, Menu, ChevronDown } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { useAuth } from "@/components/providers"
import { createBrowserSupabaseClient } from "@/lib/supabase"

export function Navbar() {
  const createBetCtaClass = "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md !bg-[#16a34a] !text-white text-sm font-semibold shadow-md transition-all duration-200 hover:!bg-[#22c55e] hover:scale-105 hover:shadow-[0_0_18px_rgba(34,197,94,0.45)] hover:shadow-lg active:scale-95"
  const createBetCtaStyle = { backgroundColor: "#16a34a", color: "#ffffff" }

  const { user, loading: authLoading, signOut } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [balance, setBalance] = useState({ fantasy: 0, real: 0 })
  const [menuNickname, setMenuNickname] = useState("")
  const userMenuRef = useRef<HTMLDivElement | null>(null)
  const supabase = createBrowserSupabaseClient()

  const displayName =
    menuNickname?.trim() || user?.nickname?.trim() || user?.email?.split("@")[0] || ""

  async function loadWalletData(userId: string) {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    const headers: HeadersInit = {}

    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`
    }

    const res = await fetch(`/api/wallet?user_id=${userId}`, {
      headers
    })

    if (!res.ok) return
    const data = await res.json()
    setMenuNickname(data.user?.nickname || "")
    if (data.wallet) {
      setBalance({
        fantasy: data.wallet.balance_fantasy,
        real: data.wallet.balance_real,
      })
    }
  }

  useEffect(() => {
    if (!user) {
      setMenuNickname("")
      setBalance({ fantasy: 0, real: 0 })
      return
    }

    setMenuNickname("")
    loadWalletData(user.id)
  }, [user?.id])

  useEffect(() => {
    if (userMenuOpen && user?.id) {
      loadWalletData(user.id)
    }
  }, [userMenuOpen, user?.id])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <nav className="border-b border-border bg-card">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded bg-primary text-primary-foreground font-extrabold tracking-tight text-lg leading-none">
                iBetYou
              </span>
            </Link>
            <Link
              href="/?create=true"
              className={`hidden md:inline-flex ${createBetCtaClass}`}
              style={createBetCtaStyle}
            >
              + Crear Apuesta
            </Link>
          </div>

          {/* Desktop navigation */}
          <div className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-sm font-medium hover:text-primary">
              Marketplace
            </Link>
            <Link href="/my-bets" className="text-sm font-medium hover:text-primary">
              Mis Apuestas
            </Link>
            <Link href="/como-jugar" className="text-sm font-medium hover:text-primary">
              Cómo Jugar
            </Link>
            <Link href="/leaderboard" className="text-sm font-medium hover:text-primary">
              Leaderboard
            </Link>
          </div>

          {/* User Section */}
          <div className="flex items-center gap-4">
            {!authLoading && user ? (
              <>
                <div className="relative" ref={userMenuRef}>
                  <button
                    type="button"
                    onClick={() => setUserMenuOpen((prev) => !prev)}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 hover:bg-secondary"
                  >
                    <User className="h-4 w-4" />
                    <div className="hidden sm:flex flex-col text-left leading-tight">
                      <span className="text-sm font-medium max-w-[180px] truncate">
                        {displayName}
                      </span>
                      <span className="text-xs text-muted-foreground max-w-[180px] truncate">
                        {user.email}
                      </span>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>

                  {userMenuOpen && (
                    <div className="absolute right-0 mt-2 w-[280px] rounded-lg border border-border bg-card shadow-lg z-50">
                      <div className="p-3 border-b border-border">
                        <div className="text-sm font-semibold truncate">{displayName}</div>
                        <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                      </div>

                      <div className="p-2">
                        <Link
                          href="/profile"
                          className="block px-3 py-2 rounded-md text-sm hover:bg-secondary"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          Perfil
                        </Link>
                        <Link
                          href="/balance"
                          className="block px-3 py-2 rounded-md text-sm hover:bg-secondary"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          Balance de Jugadas
                        </Link>
                      </div>

                      <div className="border-t border-border p-3 text-sm">
                        <div className="flex items-center gap-2 text-primary font-medium">
                          <Wallet className="h-4 w-4" />
                          <span>${balance.fantasy.toFixed(2)}</span>
                          <span className="text-xs text-muted-foreground">(Fantasy)</span>
                        </div>
                      </div>

                      <div className="border-t border-border p-2">
                        <button
                          type="button"
                          onClick={handleSignOut}
                          className="w-full px-3 py-2 rounded-md text-sm text-left hover:bg-secondary flex items-center gap-2"
                        >
                          <LogOut className="h-4 w-4" />
                          Cerrar sesión
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : !authLoading ? (
              <div className="flex items-center gap-2">
                <Button variant="ghost" asChild>
                  <Link href="/login">Iniciar Sesión</Link>
                </Button>
                <Button asChild>
                  <Link href="/register">Registrarse</Link>
                </Button>
              </div>
            ) : null}

            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border py-4">
            <div className="flex flex-col gap-2">
              <Link href="/" className="px-4 py-2 hover:bg-secondary rounded">
                Marketplace
              </Link>
              <Link href="/como-jugar" className="px-4 py-2 hover:bg-secondary rounded">
                Cómo Jugar
              </Link>
              <Link href="/leaderboard" className="px-4 py-2 hover:bg-secondary rounded">
                Leaderboard
              </Link>
              <Link
                href="/create"
                className={`${createBetCtaClass} mx-4 mt-1`}
                style={createBetCtaStyle}
              >
                + Crear Apuesta
              </Link>
              {user && (
                <>
                  <Link href="/my-bets" className="px-4 py-2 hover:bg-secondary rounded">
                    Mis Apuestas
                  </Link>
                  <Link href="/profile" className="px-4 py-2 hover:bg-secondary rounded">
                    Perfil
                  </Link>
                  <Link href="/balance" className="px-4 py-2 hover:bg-secondary rounded">
                    Balance de Jugadas
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
