"use client"

import { useState, useEffect } from "react"

interface CountdownProps {
  targetDate: string
  className?: string
  expiredLabel?: string
}

export function Countdown({ targetDate, className = "", expiredLabel = "Finalizado" }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number
    hours: number
    minutes: number
    seconds: number
    isExpired: boolean
  }>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    isExpired: false,
  })

  useEffect(() => {
    const calculateTimeLeft = () => {
      const target = new Date(targetDate).getTime()
      const now = new Date().getTime()
      const difference = target - now

      if (difference <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true }
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((difference % (1000 * 60)) / 1000),
        isExpired: false,
      }
    }

    setTimeLeft(calculateTimeLeft())
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft())
    }, 1000)

    return () => clearInterval(timer)
  }, [targetDate])

  if (timeLeft.isExpired) {
    return (
      <span className={`text-xs text-red-500 font-medium ${className}`}>
        {expiredLabel}
      </span>
    )
  }

  const timeUnits = []

  if (timeLeft.days > 0) {
    timeUnits.push(
      <span key="days" className="font-bold">
        {timeLeft.days}d
      </span>
    )
  }
  
  timeUnits.push(
    <span key="hours" className="font-bold">
      {String(timeLeft.hours).padStart(2, '0')}h
    </span>
  )
  timeUnits.push(
    <span key="minutes" className="font-bold">
      {String(timeLeft.minutes).padStart(2, '0')}m
    </span>
  )
  timeUnits.push(
    <span key="seconds" className="font-bold">
      {String(timeLeft.seconds).padStart(2, '0')}s
    </span>
  )

  return (
    <div className={`flex gap-1 text-xs ${className}`}>
      {timeUnits}
    </div>
  )
}
