import React, { useState, useEffect } from 'react'
import { searchCards } from '../api/pricetracker'
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

  async function run(e) {
    e?.preventDefault()
    const term = q.trim()
    if (!term) return
    setBusy(true)
    onError(null)
    try {
      const r = await searchCards({ q: term, limit, language })
      setResults(r.data)
      setTotal(r.total ?? r.data.length)
      setFromCache(r.cached)
      if (r.usage) onUsage(r.usage)
    } catch (err) {
      onError(err.message)
      setResults(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={bare ? '' : 'panel'}>
      {!bare && (
        <>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <h2 className="grow">Add cards</h2>
          </div>
          <p className="sub">
            Credits are charged per result, and adding a card costs 2 more for its
            price plus every graded sale average. Results cache for six hours, so
            repeating a search is free.
          </p>
        </>
      )}

      <form className="row wrap" onSubmit={run}>
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
        <button className="primary" disabled={busy || !q.trim()}>
          {busy ? 'Searching…' : `Search (${limit} credits)`}
        </button>
      </form>

      <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
        Multi-word search works well — include the set name to narrow it down.
      </p>

      {results && (
        <div style={{ marginTop: 16 }}>
          <div className="small muted" style={{ marginBottom: 10 }}>
            {results.length === 0
              ? 'No matches.'
              : `Showing ${results.length} of ${total} match${total === 1 ? '' : 'es'}`}
            {fromCache && results.length > 0 && ' · from cache (no credits used)'}
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
                      ? `You have ${qty} — click to add another`
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
