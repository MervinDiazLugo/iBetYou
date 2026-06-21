"use client"
import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function WithdrawalsRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace("/top-up") }, [router])
  return null
}
