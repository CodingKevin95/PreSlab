import React, { useState, useEffect } from 'react'
import { searchCards } from '../api/pricetracker'
import { loadSnapshot, localSearch, snapshotNow, coverageLabel } from '../lib/snapshot'
import { money } from '../lib/psa'
import CardThumb from './CardThumb'

export default function SearchPanel({ onAdd, qtyOf, onUsage, onError, adding, seed, bare }) {
  const [q, setQ] = useState(seed || '')

  /**
   * Adopts a term handed in from elsewhere -- the empty backlog, or a filter
   * that matched nothing offering to search the API instead.
   *
   * Needed because this panel is now permanently mounted. It used to be
   * created fresh each time it was opened, so the initial state above was
   * enough; left as it was, those prompts would set a term the box never
   * picked up and appear to do nothing.
   */
  useEffect(() => {
    if (seed) setQ(seed)
  }, [seed])
  const [limit, setLimit] = useState(20)
  // English and Japanese are separate collections in this API -- a Japanese
  // card simply does not appear in an English query.
  const [language, setLanguage] = useState('english')
  const [results, setResults] = useState(null)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [fromCache, setFromCache] = useState(false)
  // Results found in the shipped snapshot, which cost nothing.
  const [local, setLocal] = useState(null)
  // Shown beside the search rather than only in the page banner, which is
  // easy to miss when the failure was caused by the button you just pressed.
  const [failed, setFailed] = useState(null)
  // Whether the last API search ran off the back of an empty local one.
  const [auto, setAuto] = useState(false)

  const [hasSnapshot, setHasSnapshot] = useState(false)
  useEffect(() => { loadSnapshot().then((i) => setHasSnapshot(!!i)) }, [])

  /*
    Looks in the stored sets first, then carries on to the API by itself.

    The stored sets cover two eras. Stopping at an empty result made every
    other era look as though it did not exist, so a search that found nothing
    locally now completes against the full catalogue rather than handing back a
    blank and waiting to be asked again.

    It still costs a credit per result, so the fall-through is stated once the
    results are up rather than passed over in silence. Nothing is spent while
    the stored sets can answer.
  */
  async function runLocal(e) {
    e?.preventDefault()
    const term = q.trim()
    if (!term) return

    // With no snapshot shipped there is nothing to look through, so the one
    // obvious button does the thing that works rather than reporting an empty
    // result from a store that does not exist.
    if (!snapshotNow()) return run(e)

    onError(null)
    setResults(null)
    const hits = localSearch(term, limit)
    if (hits.length > 0) {
      setLocal(hits)
      return
    }

    setLocal(null)
    await run(e, { auto: true })
  }

  async function run(e, { auto = false } = {}) {
    e?.preventDefault()
    const term = q.trim()
    if (!term) return
    setBusy(true)
    onError(null)
    setFailed(null)
    try {
      const r = await searchCards({ q: term, limit, language })
      setResults(r.data)
      setLocal(null)
      // Records that this ran on its own rather than being asked for, so the
      // results can account for credits that were spent without a press.
      setAuto(auto && !r.cached)
      setTotal(r.total ?? r.data.length)
      setFromCache(r.cached)
      if (r.usage) onUsage(r.usage)
    } catch (err) {
      onError(err.message)
      setFailed(err.message)
      setResults(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={bare ? '' : 'panel'}>
      {/* The credit explanation that sat here is on the buttons that spend
          them -- "Search (20 credits)" and the per-card add -- so it was
          restating what the controls already say. */}
      {!bare && (
        <div className="row" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
          <h2 className="grow">Add cards</h2>
        </div>
      )}

      <form className="row wrap" onSubmit={runLocal}>
        <div className="grow">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Try: umbreon vmax alternate, or charizard base set"
          />
        </div>
        <select
          className="mini"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={{ width: 130 }}
          title="Japanese cards live in a separate collection and won't show up in an English search"
        >
          <option value="english">English</option>
          <option value="japanese">Japanese</option>
        </select>
        <select
          className="mini"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          style={{ width: 130 }}
          title="Each result costs one credit"
        >
          {[10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>{n} results</option>
          ))}
        </select>
        {/* One button. The wider API search is offered under the results
            instead, where you already know the stored sets came up short, so
            the thing that costs credits is never the first thing on screen. */}
        <button className="primary" disabled={busy || !q.trim()}>
          {busy ? 'Searching…' : hasSnapshot ? 'Search' : `Search (${limit} credits)`}
        </button>
      </form>

      {failed ? (
        <p className="small" style={{ marginTop: 8, marginBottom: 0, color: 'var(--bad)' }}>
          {failed}{' '}
          <button className="ghost small" onClick={run} disabled={busy}>Try again</button>
        </p>
      ) : (
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
          Multi-word search works well. Include the set name to narrow it down.
        </p>
      )}

      {/* Results from the shipped snapshot. Free, so they are shown first and
          the API is offered only if these are not what you wanted. */}
      {local && (
        <div style={{ marginTop: 16 }}>
          <div className="small muted" style={{ marginBottom: 10 }}>
            {local.length === 0
              ? `No match in the stored sets${coverageLabel() ? ` (${coverageLabel()})` : ''}. Cards from other eras need the full search below.`
              : `${local.length} from the stored sets, no credits used`}
            {local.length > 0 && snapshotNow()?.sets?.length
              ? ` · ${snapshotNow().sets.length} sets stored`
              : ''}
          </div>
          {local.length > 0 && (
            <div className="search-results">
              {local.map((c) => (
                <Result
                  key={c.tcgPlayerId}
                  card={c}
                  onAdd={onAdd}
                  qtyOf={qtyOf}
                  adding={adding}
                />
              ))}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Looking for another era?{' '}
            <button className="ghost small" onClick={run} disabled={busy}>
              {busy ? 'Searching…' : `Search every era (${limit} credits)`}
            </button>{' '}
            covers the full catalogue, at one credit per result.
          </p>
        </div>
      )}

      {results && (
        <div style={{ marginTop: 16 }}>
          <div className="small muted" style={{ marginBottom: 10 }}>
            {results.length === 0
              ? 'No matches in any era.'
              : `Showing ${results.length} of ${total} match${total === 1 ? '' : 'es'}, every era`}
            {fromCache && results.length > 0 && ' · from cache (no credits used)'}
            {auto && results.length > 0 && ` · not in the stored sets, so this searched the full catalogue (${results.length} credits)`}
          </div>
          {/* Results scroll inside their own box so a 100-result search does
              not push the backlog off the bottom of the page. */}
          <div className="search-results">
            {results.map((c) => (
              <Result
                key={c.tcgPlayerId}
                card={c}
                onAdd={onAdd}
                qtyOf={qtyOf}
                adding={adding}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Result({ card, onAdd, qtyOf, adding }) {
  return (
    <div className="result">
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <CardThumb src={card.image} alt={card.name} width={54} />
        <div className="grow">
          <div className="result-head">
            <span className="cardname">{card.name}</span>
            <span className="cardmeta">
              {card.setName} · #{card.number} · {card.rarity}
            </span>
          </div>

          <div className="variants">
            {card.printings.map((p) => {
              const qty = qtyOf(card.tcgPlayerId, p.printing)
              const busy = adding === `${card.tcgPlayerId}:${p.printing}`
              return (
                <button
                  key={p.printing}
                  className={'variant' + (qty > 0 ? ' added' : '')}
                  onClick={() => onAdd(card, p)}
                  disabled={busy}
                  title={
                    qty > 0
                      ? `You have ${qty}. Click to add another`
                      : 'Add to backlog (2 credits: price + graded sales)'
                  }
                >
                  <span>{p.printing}</span>
                  <b>{money(p.price)}</b>
                  <span>{busy ? '…' : qty > 0 ? `✓ ${qty}` : '+'}</span>
                </button>
              )
            })}
            {card.printings.length === 0 && (
              <span className="muted small">No priced printings.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
