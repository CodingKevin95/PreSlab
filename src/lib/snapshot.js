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
    .then((res) => {
      if (!res.ok) return null
      /*
        A misrouted request returns the page shell with a 200, which would
        throw in the JSON parse below and be swallowed as "no snapshot". The
        app would work, just slowly and expensively, with nothing to say why.
        Checking the type turns that into something visible.
      */
      const type = res.headers.get('content-type') || ''
      if (!type.includes('json')) {
        console.warn(
          'Snapshot request returned ' + (type || 'no content type') +
          ' rather than JSON. It is probably being caught by a rewrite, so ' +
          'every lookup will go to the API instead.'
        )
        return null
      }
      return res.json()
    })
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
    .then((result) => {
      /*
        A failed attempt must not be remembered.

        The in-flight promise is kept so concurrent callers share one request,
        but holding it after a failure meant the first miss was permanent: a tab
        opened before the file was deployed would keep answering "no snapshot"
        from that one stale rejection, and every lookup would go to the API for
        the life of the page.
      */
      if (!result) loading = null
      return result
    })

  return loading
}

/** Whatever has already loaded, without triggering a load. */
export function snapshotNow() {
  return index
}

/**
 * The eras the snapshot covers, as prose.
 *
 * An empty local result is only understandable if you can see what was
 * searched. "Nothing found" against an unnamed set of stored sets reads as a
 * broken search rather than one looking somewhere the card was never going to
 * be, which is exactly how it was read.
 */
export function coverageLabel() {
  const names = [...new Set((index?.sets || []).map((s) => s.series).filter(Boolean))]
  if (!names.length) return null
  if (names.length === 1) return names[0]
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
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
