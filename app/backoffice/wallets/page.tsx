"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { 
  Wallet, 
  Plus, 
  Minus,
  Search,
  User,
  Coins
} from "lucide-react"
import { formatCurrency } from "@/lib/utils"
import { createBrowserSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/components/toast"

interface WalletData {
  user_id: string
  balance_fantasy: number
  balance_real: number
  user: {
    id: string
    nickname: string
    email: string
    avatar_url: string | null
  }
}

export default function BackofficeWallets() {
  const supabase = createBrowserSupabaseClient()
  const { showToast } = useToast()
  const [wallets, setWallets] = useState<WalletData[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("")
  const [selectedWallet, setSelectedWallet] = useState<WalletData | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionData, setActionData] = useState({
    amount: 0,
    token_type: 'fantasy',
    notes: ''
  })

  async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(init?.headers)
    if (session?.access_token) {
      headers.set("Authorization", `Bearer ${session.access_token}`)
    }

    return fetch(input, {
      ...init,
      headers,
    })
  }

  async function fetchWallets() {
    setLoading(true)
    try {
      const res = await authFetch('/api/admin/wallets?limit=100')
      const data = await res.json()
      setWallets(data.wallets || [])
    } catch (err) {
      console.error('Error fetching wallets:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWallets()
  }, [])

  async function handleTransaction(action: 'add' | 'subtract') {
    if (!selectedWallet || actionData.amount <= 0) {
      showToast('Ingresa un monto válido', 'error')
      return
    }

    setActionLoading(true)
    try {
      const res = await authFetch('/api/admin/wallets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          user_id: selectedWallet.user_id,
          amount: actionData.amount,
          token_type: actionData.token_type,
          notes: actionData.notes
        })
      })

      const data = await res.json()
      
      if (res.ok) {
        showToast(`${action === 'add' ? 'Agregado' : 'Restado'} ${formatCurrency(actionData.amount)} exitosamente`, 'success')
        setSelectedWallet(null)
        setActionData({ amount: 0, token_type: 'fantasy', notes: '' })
        fetchWallets()
      } else {
        showToast(data.error || 'Error al realizar la transacción', 'error')
      }
    } catch (err) {
      console.error('Error:', err)
    } finally {
      setActionLoading(false)
    }
  }

  const filteredWallets = wallets.filter(wallet => {
    if (!filter) return true
    const search = filter.toLowerCase()
    return (
      wallet.user?.nickname?.toLowerCase().includes(search) ||
      wallet.user?.email?.toLowerCase().includes(search) ||
      wallet.user_id.includes(search)
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestión de Billeteras</h1>
          <p className="text-muted-foreground">Recarga y administra fondos de usuarios</p>
        </div>
        <Button variant="outline" onClick={fetchWallets}>
          Actualizar
        </Button>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, email o ID..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Wallets List */}
      {loading ? (
        <div className="text-center py-12">Cargando...</div>
      ) : filteredWallets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wallet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No hay billeteras</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredWallets.map((wallet) => (
            <Card key={wallet.user_id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{wallet.user?.nickname || 'Usuario'}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {wallet.user?.email}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-primary" />
                      <span className="text-sm">Fantasy</span>
                    </div>
                    <span className="font-bold text-primary">
                      {formatCurrency(wallet.balance_fantasy)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Real</span>
                    </div>
                    <span className="font-bold">
                      {formatCurrency(wallet.balance_real)}
                    </span>
                  </div>
                </div>
                <Button 
                  className="w-full mt-4" 
                  variant="outline"
                  onClick={() => setSelectedWallet(wallet)}
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Gestionar Fondos
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Transaction Modal */}
      {selectedWallet && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Gestionar Fondos</CardTitle>
              <p className="text-sm text-muted-foreground">
                Usuario: {selectedWallet.user?.nickname || selectedWallet.user?.email}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-3 bg-secondary/50 rounded-lg">
                <div>
                  <div className="text-xs text-muted-foreground">Fantasy</div>
                  <div className="font-bold text-primary">
                    {formatCurrency(selectedWallet.balance_fantasy)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Real</div>
                  <div className="font-bold">
                    {formatCurrency(selectedWallet.balance_real)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo de Token</label>
                <select
                  value={actionData.token_type}
                  onChange={(e) => setActionData({...actionData, token_type: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg border bg-background"
                >
                  <option value="fantasy">Fantasy</option>
                  <option value="real">Real</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Monto</label>
                <Input
                  type="number"
                  min={1}
                  value={actionData.amount}
                  onChange={(e) => setActionData({...actionData, amount: parseFloat(e.target.value) || 0})}
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Notas (opcional)</label>
                <Input
                  value={actionData.notes}
                  onChange={(e) => setActionData({...actionData, notes: e.target.value})}
                  placeholder="Razón de la transacción"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setSelectedWallet(null)}
                >
                  Cancelar
                </Button>
                <Button 
                  variant="outline"
                  className="flex-1 border-red-500/50 hover:bg-red-500/10"
                  onClick={() => handleTransaction('subtract')}
                  disabled={actionLoading}
                >
                  <Minus className="h-4 w-4 mr-2" />
                  Restar
                </Button>
                <Button 
                  className="flex-1"
                  onClick={() => handleTransaction('add')}
                  disabled={actionLoading}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
