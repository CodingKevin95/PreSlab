import React, { useState, useMemo, useEffect } from 'react'
import CardThumb from './CardThumb'
import { scanMarket, getSets } from '../api/pricetracker'
import { screenMarket, money, percent } from '../lib/psa'

/**
 * Finds cards worth grading across the market, rather than reporting on cards
 * already in the backlog.
 *
 * The API has no server-side filter for either return or sales volume -- both
 * live in the per-card ebay payload, which is charged for -- so the pool has to
 * be fetched before it can be narrowed. Everything here is built around that:
 * an explicit page budget, a visible credit cost, and results kept in state so
 * changing a threshold re-filters what was already paid for instead of
 * scanning again.
 */
/**
 * @param cache Scan results held by the parent.
 *
 * Kept outside this component because the tab unmounts when you leave it, and
 * losing the results meant every visit re-ran a scan that had already been paid
 * for. Whether the repeat was billed depended on the CDN still holding the
 * pages, which is not something the user can see or rely on.
 */
export default function ScreenerPanel({
  tiers, settings, onAdd, onUsage, onError, owned, onGoToSettings, cache, setCache,
}) {
  const [minPrice, setMinPrice] = useState('1')
  const [maxPrice, setMaxPrice] = useState('1000000')
  const [count, setCount] = useState(200)
  const [showBand, setShowBand] = useState(false)
  const [minWeekly, setMinWeekly] = useState('25')
  const [minSales, setMinSales] = useState('3')
  const [hideSuspect, setHideSuspect] = useState(true)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [sets, setSets] = useState(null)

  const scanned = cache?.cards || null
  const scanInfo = cache?.info || null
  const [era, setEra] = useState('all')
  // Which era to scan, as opposed to `era`, which narrows results already paid
  // for. Choosing here is what stops credits going on eras you don't want.
  const [scanEra, setScanEra] = useState('all')

  // Loaded up front so the era can be chosen before spending anything. Three
  // credits, cached for a week, and it fails quietly -- an unavailable set list
  // should cost the scan button, not disable it.
  useEffect(() => {
    let live = true
    getSets()
      .then((r) => { if (live && r?.sets) setSets(r.sets) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  const scannableEras = useMemo(() => {
    const counts = new Map()
    for (const s of sets || []) {
      if (!s.series || s.setId == null) continue
      counts.set(s.series, (counts.get(s.series) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [sets])

  const creditCost = count * 2

  async function run() {
    setBusy(true)
    setProgress(null)
    onError(null)
    try {
      // Fetched alongside the scan so results can show which era each card is
      // from. Three credits, and cached for a week, so it is effectively a
      // one-off next to the scan itself.
      const { cards, usage, total, freePages, pages, setsCovered, setsTotal } = await scanMarket({
        minPrice: Number(minPrice) || 1,
        maxPrice: Number(maxPrice) || 1000000,
        count,
        series: scanEra === 'all' ? null : scanEra,
        onProgress: (p) => setProgress(p),
      })
      setCache({
        cards,
        info: {
          total, at: Date.now(), series: scanEra, freePages, pages, count,
          setsCovered, setsTotal,
        },
      })
      // Results are already one era, so the post-scan narrowing would only
      // repeat the choice just made.
      setEra('all')
      if (usage) onUsage(usage)
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  // Re-filtering is free -- it runs over cards already fetched -- so the
  // thresholds apply as you type rather than needing another scan.
  const result = scanned
    ? screenMarket(scanned, tiers, settings, {
        minWeekly: Number(minWeekly) || 0,
        minSales: Number(minSales) || 0,
        // Over-fetched then trimmed below, so hiding flagged rows still leaves
        // a full 25 rather than 25 minus however many were flagged.
        limit: hideSuspect ? 200 : 25,
      })
    : null

  const seriesById = useMemo(() => {
    const m = new Map()
    for (const s of sets || []) if (s.setId != null) m.set(String(s.setId), s)
    return m
  }, [sets])

  const eraOf = (s) => seriesById.get(String(s.setId))?.series || null

  // Only eras actually present in the results, so the dropdown never offers a
  // choice that filters everything away.
  const eras = useMemo(() => {
    const seen = new Set()
    for (const r of result?.rows || []) {
      const e = eraOf(r.scanned)
      if (e) seen.add(e)
    }
    return [...seen].sort()
  }, [result, seriesById])

  const rows = result
    ? (hideSuspect ? result.rows.filter((r) => !r.suspect) : result.rows)
        .filter((r) => era === 'all' || eraOf(r.scanned) === era)
        .slice(0, 25)
    : []
  const suspectCount = result ? result.rows.filter((r) => r.suspect).length : 0

  const withComps = scanned
    ? scanned.filter((s) => s.graded?.byCompany?.PSA?.['10']).length
    : 0

  return (
    <>
      <div className="panel">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <h2 className="grow">Find cards worth grading</h2>
        </div>
        <p className="sub">
          Ranks cards by return after fees, keeping only those whose PSA 10 trades
          often enough for its price to mean something. Nothing here is from your
          backlog.
        </p>

        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div style={{ width: 210 }}>
            <label
              className="small muted"
              title="Scans only this era's sets, so credits are not spent on cards you would filter out afterwards."
            >
              Era to scan
            </label>
            <select value={scanEra} onChange={(e) => setScanEra(e.target.value)}>
              <option value="all">Everything, priciest first</option>
              {scannableEras.map(([name, n]) => (
                <option key={name} value={name}>{name} ({n} sets)</option>
              ))}
            </select>
          </div>
          <div style={{ width: 150 }}>
            <label className="small muted">Cards to scan</label>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {/* Multiples of the 100-card page, so every scan size reuses the
                  same cached pages instead of paying for its own. */}
              {[100, 200, 500, 1000].map((n) => (
                <option key={n} value={n}>{n} cards</option>
              ))}
            </select>
          </div>
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? 'Scanning…' : `Scan (${creditCost.toLocaleString()} credits)`}
          </button>
          <div className="grow" />
          <button className="ghost small" onClick={() => setShowBand((v) => !v)}>
            {showBand ? 'Hide price range' : 'Price range'}
          </button>
        </div>

        {/* The API rejects a query with no filter at all, so a price range has
            to be sent. It is defaulted wide enough to be a non-filter and kept
            out of the way, since it is a constraint of the API rather than
            something worth deciding. */}
        {showBand && (
          <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end', marginTop: 10 }}>
            <div style={{ width: 130 }}>
              <label className="small muted">Min raw price</label>
              <input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
            </div>
            <div style={{ width: 130 }}>
              <label className="small muted">Max raw price</label>
              <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
            </div>
            <span className="small muted" style={{ paddingBottom: 8 }}>
              Only here because the API needs at least one filter. Leave it wide.
            </span>
          </div>
        )}

        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {scanEra === 'all'
            ? 'Most valuable cards first across every era — which in practice means '
              + 'mostly vintage, since those carry the highest prices.'
            : `Spread evenly across the ${scanEra} sets, most valuable first in each, `
              + 'so the whole era is represented rather than just its newest releases.'}
          {' '}Up to 2 credits per card: graded sale data has to be fetched before
          anything can be ranked. Results are shared for six hours, so a scan someone
          has already run today costs nothing.
        </p>

        {progress && (
          <p className="small" style={{ marginTop: 8, marginBottom: 0, color: 'var(--accent)' }}>
            Scanned {progress.scanned} of {progress.pages * 100}
            {progress.total ? ` · ${progress.total.toLocaleString()} cards in this band` : ''}
          </p>
        )}
      </div>

      {scanned && (
        <div className="panel">
          <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div style={{ width: 190 }}>
              <label
                className="small muted"
                title="Filters on how often the PSA 10 itself trades, not the card overall. A PSA 10 price built on a handful of sales is not a market price."
              >
                Min PSA 10 sales / week
              </label>
              <input value={minWeekly} onChange={(e) => setMinWeekly(e.target.value)} />
            </div>
            <div style={{ width: 170 }}>
              <label className="small muted">Min PSA 10 sales</label>
              <input value={minSales} onChange={(e) => setMinSales(e.target.value)} />
            </div>
            {eras.length > 1 && (
              <div style={{ width: 180 }}>
                <label className="small muted">Era</label>
                <select value={era} onChange={(e) => setEra(e.target.value)}>
                  <option value="all">All eras</option>
                  {eras.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>
            )}
            <label
              className="small"
              style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}
              title="Hides rows where the graded price or the raw price looks wrong rather than promising. Ranking by return puts these at the top, so they are on by default."
            >
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={hideSuspect}
                onChange={(e) => setHideSuspect(e.target.checked)}
              />
              Hide implausible ({suspectCount})
            </label>
            <div className="grow" />
            <span className="small muted">
              {scanned.length} scanned · {withComps} with PSA 10 comps ·{' '}
              {result.matched} pass filters
              {/* Says outright what the scan cost, so it is clear when someone
                  else's earlier scan paid for it. */}
              {scanInfo?.pages > 0 && (
                <>
                  {' · '}
                  {scanInfo.freePages === scanInfo.pages ? (
                    <span style={{ color: 'var(--good, #3fb950)' }}>
                      free, already cached
                    </span>
                  ) : scanInfo.freePages > 0 ? (
                    <span>
                      {scanInfo.freePages} of {scanInfo.pages} pages were cached
                    </span>
                  ) : (
                    <span>freshly fetched</span>
                  )}
                </>
              )}
            </span>
          </div>

          {result.matched === 0 && (
            <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
              Nothing clears {minWeekly} sales per week.{' '}
              <button className="ghost small" onClick={() => setMinWeekly('5')}>
                Try 5 per week
              </button>
              <span className="muted">
                {' '}— graded Pokémon cards rarely trade more than a few times a week,
                so a high bar can exclude everything.
              </span>
            </p>
          )}

          {/* A budget too small to reach every set covers fewer sets properly
              rather than all of them thinly, so say which -- otherwise this
              reads as "the whole era" when it is the newest part of it. */}
          {scanInfo?.setsTotal > 0 && scanInfo.setsCovered < scanInfo.setsTotal && (
            <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
              Covered the {scanInfo.setsCovered} newest {scanInfo.series} sets of{' '}
              {scanInfo.setsTotal} — the rest need a larger scan.
            </p>
          )}

          {/* The returns for these are overstated, and scanning most-valuable
              -first makes them common rather than rare, so this cannot be left
              to a tooltip on the row. */}
          {rows.some((r) => r.noTier) && (
            <p className="small" style={{ marginTop: 10, marginBottom: 0, color: '#d9a441' }}>
              {rows.filter((r) => r.noTier).length} of these are worth more than your
              highest grading tier covers, so they are costed as though grading were
              free and their ROI is too high.{' '}
              <button className="ghost small" onClick={onGoToSettings}>
                Add higher tiers
              </button>
            </p>
          )}

          {/* Fewer results than asked for is nearly always too small a scan
              rather than a thin market, so say so with the actual arithmetic
              instead of leaving a short list unexplained. */}
          {rows.length > 0 && rows.length < 25 && (
            <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
              {rows.length} of 25 — only {scanned.length} cards were scanned, and about{' '}
              {Math.round((result.matched / scanned.length) * 100)}% pass your filters.
              Scanning about {Math.min(2000, Math.max(50, Math.ceil(25 / Math.max(result.matched / scanned.length, 0.01) / 25) * 25))} cards
              would fill the list.
            </p>
          )}

          {/* Every match hidden as implausible would otherwise render an empty
              page with no explanation of where the results went. */}
          {result.matched > 0 && rows.length === 0 && (
            <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
              All {result.matched} matches were flagged as implausible.{' '}
              <button className="ghost small" onClick={() => setHideSuspect(false)}>
                Show them anyway
              </button>
              <span className="muted"> — expect bad data rather than bargains.</span>
            </p>
          )}
        </div>
      )}

      {result && rows.length > 0 && (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th className="card-col">Card</th>
                <th className="num" title="Raw market value of one copy">Raw value</th>
                <th>Tier</th>
                <th className="num" title="Value of one copy at PSA 10">Graded value</th>
                <th
                  className="num"
                  title="PSA 10 sales per week over the tracked window — the figure the filter uses. Beneath it is the card's total rate across all grades and raw, for context."
                >
                  PSA 10 / wk
                </th>
                <th className="num" title="Return after selling fees, on raw value plus grading cost">
                  ROI
                </th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ scanned: s, analysis: a, volume, gradeRate, meta, suspect, reasons, noTier }) => {
                const already = owned.has(String(s.tcgPlayerId))
                return (
                  <tr key={s.tcgPlayerId}>
                    <td className="card-col">
                      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                        <CardThumb src={s.image} alt={s.name} width={40} />
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {s.name}
                            {suspect && (
                              <span
                                className="small"
                                style={{ marginLeft: 6, color: '#d9a441' }}
                                title={reasons.join('\n\n')}
                              >
                                ⚠ check
                              </span>
                            )}
                          </div>
                          <div className="small muted">
                            {eraOf(s) && (
                              <>
                                <span style={{ color: 'var(--accent)' }}>{eraOf(s)}</span>
                                {' · '}
                              </>
                            )}
                            {s.setName} · #{s.number}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{money(a.raw)}</td>
                    <td className="small">
                      {a.tier ? (
                        a.tier.name
                      ) : (
                        <span
                          style={{ color: '#d9a441' }}
                          title={
                            `No tier covers a declared value of ${money(a.declared)}. Your highest ` +
                            `tier stops below it, so this card is costed as though grading were ` +
                            `free and the return below is too high. Add the tier in Settings.`
                          }
                        >
                          ⚠ no tier
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {money(a.gradedPrice)}
                      <div className="small muted">
                        {meta.count} sales
                        {a.multiple != null && ` · ${a.multiple.toFixed(1)}×`}
                      </div>
                    </td>
                    <td className="num">
                      {gradeRate != null ? gradeRate.toFixed(1) : '—'}
                      <div className="small muted">
                        {volume.overWindow != null
                          ? `${volume.overWindow.toFixed(1)} all grades`
                          : ''}
                      </div>
                    </td>
                    <td className="num">
                      <span className="verdict strong">{percent(a.roiNet)}</span>
                      <div className="small muted">{money(a.upliftNet)}</div>
                    </td>
                    <td>
                      <button
                        className="ghost small"
                        disabled={already}
                        onClick={() => onAdd(s)}
                        title={already ? 'Already in your backlog' : 'Add to backlog'}
                      >
                        {already ? 'Added' : '+ Backlog'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
