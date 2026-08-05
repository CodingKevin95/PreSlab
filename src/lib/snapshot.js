/**
 * Prices shipped with the app for a chosen set of sets.
 *
 * The point is to keep the metered API off the path a user waits on. A card
 * that is in here costs nothing and appears instantly; anything else still goes
 * to the API exactly as before, so the snapshot only ever adds coverage.
 *
 * It is a file rather than a database because the contents never change at
 * runtime: it is rebuilt by hand, committed, and served from the CDN. That is
 * the cheapest possible way to hold data nobody writes to.
 */
import { slimToCard } from './snapshotShape'

let loading = null
let index = null

/**
 * Loads once, lazily, and never blocks the app.
 *
 * Deliberately not imported at module scope: it is a few hundred kilobytes,
 * and someone who opens Settings should not pay for it. A failure is not an
 * error either -- the snapshot is an optimisation, and the API path still
 * works without it.
 */
export function loadSnapshot() {
  if (index) return Promise.resolve(index)
  if (loading) return loading

  loading = fetch('/data/snapshot.json')
    .then((res) => (res.ok ? res.json() : null))
    .then((doc) => {
      if (!doc?.cards?.length) return null

      const byId = new Map()
      // Lower-cased once at load rather than on every keystroke of a search.
      const rows = doc.cards.map((c) => {
        byId.set(String(c.id), c)
        return {
          c,
          hay: `${c.n || ''} ${c.s || ''} ${c.num || ''} ${c.r || ''}`.toLowerCase(),
        }
      })

      index = { builtAt: doc.builtAt, sets: doc.sets || [], byId, rows }
      return index
    })
    .catch(() => null)

  return loading
}

/** Whatever has already loaded, without triggering a load. */
export function snapshotNow() {
  return index
}

/** One card by TCGplayer id, in the shape the rest of the app expects. */
export function localCard(tcgPlayerId) {
  const hit = index?.byId.get(String(tcgPlayerId))
  return hit ? slimToCard(hit) : null
}

/**
 * Cards matching a query, ranked so exact-ish matches come first.
 *
 * Same rule as every other search here: each word must appear somewhere, so
 * extra words narrow rather than broaden.
 */
export function localSearch(query, limit = 20) {
  if (!index) return []
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []

  const hits = []
  for (const row of index.rows) {
    if (!terms.every((t) => row.hay.includes(t))) continue
    hits.push(row)
    // A local search is free, but building thousands of card objects is not,
    // and nobody reads past the first screen anyway.
    if (hits.length >= limit * 4) break
  }

  // A card whose name starts with the query is almost always the one meant.
  const first = terms[0]
  hits.sort((a, b) => {
    const an = (a.c.n || '').toLowerCase()
    const bn = (b.c.n || '').toLowerCase()
    return (bn.startsWith(first) ? 1 : 0) - (an.startsWith(first) ? 1 : 0)
  })

  return hits.slice(0, limit).map((r) => slimToCard(r.c))
}
