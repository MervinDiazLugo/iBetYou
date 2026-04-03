"use client"

import * as React from "react"
import { X } from "lucide-react"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 w-full max-w-2xl max-h-[92vh] overflow-y-auto px-3 sm:px-4">
        {children}
      </div>
    </div>
  )
}

export function DialogContent({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="relative bg-card border border-border rounded-lg shadow-2xl">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-secondary z-10"
        >
          <X className="h-5 w-5" />
        </button>
      )}
      {children}
    </div>
  )
}
