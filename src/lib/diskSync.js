import { useState, useEffect, useRef } from 'react'

const ENDPOINT = '/api/data'

/**
 * Mirrors the whole document to a JSON file on disk via the dev server.
 *
 * Disk is the source of truth. On startup, whatever is in the file wins; if
 * the file does not exist yet, whatever is already in localStorage is adopted
 * and written out, so an existing browser-only backlog migrates itself on the
 * first run without the user doing anything.
 *
 * localStorage keeps being written as a mirror. If the dev server is down the
 * app still works, it just falls back to browser-only storage and says so.
 */
export function useDiskSync(doc, applyRef, localCardCount = 0) {
  const [state, setState] = useState({ status: 'loading', savedAt: null, error: null, path: null })
  const loaded = useRef(false)
  const timer = useRef(null)

  // --- initial load -------------------------------------------------------
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch(ENDPOINT)
        const json = await res.json()
        if (cancelled) return

        const diskCards = Array.isArray(json.cards) ? json.cards.length : null

        // An empty disk file must never overwrite a browser store that still
        // holds cards. That combination means the file was never written, or
        // was truncated -- either way localStorage is the better copy, and
        // adopting the empty file would silently destroy the backlog.
        const emptyDiskWouldWipeBrowser = diskCards === 0 && localCardCount > 0

        if (!json.empty && diskCards !== null && !emptyDiskWouldWipeBrowser) {
          applyRef.current(json)
          setState({ status: 'ready', savedAt: json.savedAt || null, error: null, path: null })
        } else {
          // Either there is no file yet, or the file is empty while the
          // browser has data. Keep what the browser holds; the save effect
          // below writes it straight back out to disk.
          setState({
            status: 'ready',
            savedAt: null,
            path: null,
            error: emptyDiskWouldWipeBrowser
              ? `Disk file was empty but this browser held ${localCardCount} card(s) — kept the browser copy and rewrote it to disk.`
              : null,
          })
        }
      } catch {
        if (cancelled) return
        // No file store. That is an error when running locally and the normal
        // state when hosted, so it is reported plainly rather than as a fault
        // -- browser storage is a legitimate place for this data to live.
        setState({ status: 'browser', savedAt: null, path: null, error: null })
      } finally {
        if (!cancelled) loaded.current = true
      }
    })()

    return () => { cancelled = true }
  }, [applyRef])

  // --- debounced save -----------------------------------------------------
  const serialized = JSON.stringify(doc)

  useEffect(() => {
    if (!loaded.current) return
    // Nothing to write to when there is no file store.
    if (state.status === 'browser') return

    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setState((s) => ({ ...s, status: 'saving' }))
      try {
        const res = await fetch(ENDPOINT, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: serialized,
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Save failed')
        setState({ status: 'saved', savedAt: json.savedAt, error: null, path: json.path })
      } catch (err) {
        setState((s) => ({ ...s, status: 'error', error: err.message }))
      }
    }, 500)

    return () => clearTimeout(timer.current)
  }, [serialized, state.status])

  return state
}
