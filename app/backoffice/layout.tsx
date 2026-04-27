"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import {
  LayoutDashboard,
  Trophy,
  Calendar,
  Wallet,
  LogOut,
  Menu,
  X,
  Users,
  BarChart2,
  ClipboardList
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ToastProvider } from "@/components/toast"

const navigation = [
  { name: "Dashboard", href: "/backoffice", icon: LayoutDashboard },
  { name: "Moderación de Apuestas", href: "/backoffice/bets", icon: Trophy },
  { name: "Eventos", href: "/backoffice/events", icon: Calendar },
  { name: "Recargas iBY", href: "/backoffice/top-up", icon: Wallet },
  { name: "Usuarios", href: "/backoffice/users", icon: Users },
  { name: "Financials", href: "/backoffice/financials", icon: BarChart2 },
  { name: "Auditoría", href: "/backoffice/audit", icon: ClipboardList },
]

export default function BackofficeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [user, setUser] = useState<{ id: string; email: string; role: string } | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createBrowserSupabaseClient()

  useEffect(() => {
    if (pathname === "/backoffice/login") return

    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push("/backoffice/login")
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      if (!token) {
        router.push("/backoffice/login")
        return
      }

      const res = await fetch('/api/user/info', {
        headers: {
          Authorization: `Bearer ${token}`,
        }
      })

      if (!res.ok) {
        router.push('/backoffice/login')
        return
      }

      const info = await res.json()
      const role = info?.user?.role || 'app_user'

      if (role !== 'backoffice_admin') {
        await supabase.auth.signOut()
        router.push('/backoffice/login')
        return
      }

      setUser({ id: user.id, email: user.email!, role })
    }

    checkAuth()
  }, [router, supabase, pathname])

  if (pathname === "/backoffice/login") {
    return <>{children}</>
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p>Cargando...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile sidebar */}
      <div className={`fixed inset-0 z-50 lg:hidden ${sidebarOpen ? 'block' : 'hidden'}`}>
        <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
        <div className="fixed inset-y-0 left-0 w-64 bg-card border-r">
          <div className="flex items-center justify-between p-4 border-b">
            <span className="text-xl font-bold">Admin Panel</span>
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <nav className="p-4 space-y-2">
            {navigation.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                    isActive 
                      ? 'bg-primary text-primary-foreground' 
                      : 'hover:bg-secondary'
                  }`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:block">
        <div className="flex flex-col h-full bg-card border-r">
          <div className="flex items-center justify-between p-4 border-b">
            <span className="text-xl font-bold">Admin Panel</span>
          </div>
          <nav className="flex-1 p-4 space-y-2">
            {navigation.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                    isActive 
                      ? 'bg-primary text-primary-foreground' 
                      : 'hover:bg-secondary'
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </Link>
              )
            })}
          </nav>
          <div className="p-4 border-t">
            <Button variant="outline" className="w-full justify-start" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Cerrar Sesión
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-card border-b px-4 py-3 lg:hidden">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <span className="font-bold">Admin Panel</span>
            <div className="w-10" />
          </div>
        </header>

        <main className="p-6">
          <ToastProvider>
            {children}
          </ToastProvider>
        </main>
      </div>
    </div>
  )
}
