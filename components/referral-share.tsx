"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/toast"

interface ReferralShareProps {
  shareUrl: string
  whatsappUrl: string
}

export function ReferralShare({ shareUrl, whatsappUrl }: ReferralShareProps) {
  const { showToast } = useToast()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      showToast("Enlace copiado al portapapeles", "success")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast("No se pudo copiar el enlace", "error")
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-3 border border-gray-700">
        <span className="text-gray-300 text-sm flex-1 truncate">{shareUrl}</span>
        <Button
          size="sm"
          onClick={handleCopy}
          className="bg-blue-600 hover:bg-blue-500 text-white shrink-0"
        >
          {copied ? "¡Copiado!" : "Copiar"}
        </Button>
      </div>
      <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="block">
        <Button className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold">
          📲 Compartir por WhatsApp
        </Button>
      </a>
    </div>
  )
}
