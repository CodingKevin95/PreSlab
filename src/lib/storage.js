import { useState, useEffect, useCallback, useMemo } from 'react'

const PREFIX = 'psa-backlog:'

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch (e) {
    console.error('[psa-backlog] could not persist', key, e)
  }
}

export function usePersisted(key, fallback) {
  const [value, setValue] = useState(() => load(key, fallback))
  useEffect(() => { save(key, value) }, [key, value])
  return [value, setValue]
}

/**
 * Daily API call counter. The free tier allows 100 calls/day resetting at
 * 00:00 UTC, so the bucket key is the UTC date.
 */
function utcDay() {
  return new Date().toISOString().slice(0, 10)
}

export function useCallBudget() {
  const [state, setState] = useState(() => {
    // The limit is remembered alongside the count. Without it, a fresh page
    // load falls back to a hard-coded default and can render something like
    // "220/100" until the first API response arrives.
    const s = load('budget', { day: utcDay(), used: 0, limit: null })
    return s.day === utcDay() ? s : { day: utcDay(), used: 0, limit: s.limit ?? null }
  })

  useEffect(() => { save('budget', state) }, [state])

  // Overwrites the stored count with the server's own number, which every
  // successful response carries in _metadata. Stable identity: callers put this
  // in effect dependency lists, and a fresh function each render would make
  // those effects re-fire forever.
  const sync = useCallback((usedToday, limit) => {
    if (!Number.isFinite(usedToday)) return
    setState((prev) => {
      const today = utcDay()
      const nextLimit = Number.isFinite(limit) ? limit : prev.limit
      if (prev.day === today && prev.used === usedToday && prev.limit === nextLimit) return prev
      return { day: today, used: usedToday, limit: nextLimit }
    })
  }, [])

  return useMemo(
    () => ({ used: state.used, limit: state.limit, sync }),
    [state.used, state.limit, sync]
  )
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
