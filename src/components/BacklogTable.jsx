import React, { useState } from 'react'
import { getCard } from '../api/pricetracker'
import CardThumb from './CardThumb'
import {
  analyzeCard, money, percent, nearestGrade, statusOf, STATUSES, GRADE_OPTIONS,
  resolveGradePrice,
} from '../lib/psa'

/**
 * Cost basis entry: one price per copy owned.
 *
 * Storing each copy separately rather than a running total means a card bought
 * repeatedly at different prices is recorded exactly, not averaged away, and
 * you can see which copy cost what.
 *
 * "Total spent" is the shortcut for the common case of one purchase covering
 * several copies -- it just divides evenly and fills the same per-copy fields,
 * so the two modes never disagree about where the numbers live.
 */
function CostBasis({ card, a, onPatch }) {
  const [mode, setMode] = useState('each')
  const [bulk, setBulk] = useState('')

  const setCopy = (i, value) => {
    const next = a.costs.slice()
    next[i] = value
    onPatch({ costs: next, costTotal: undefined })
  }

  // Spread a lump sum evenly across every copy.
  const bulkEach = (() => {
    if (bulk.trim() === '') return null
    const t = Number(bulk)
    if (!Number.isFinite(t) || t < 0 || a.qty < 1) return null
    return t / a.qty
  })()

  function applyBulk() {
    if (bulkEach == null) return
    onPatch({
      costs: Array.from({ length: a.qty }, () => bulkEach.toFixed(2)),
      costTotal: undefined,
    })
    setBulk('')
  }

  return (
    <>
      <div className="row" style={{ gap: 4, marginBottom: 10 }}>
        <button
          className={mode === 'each' ? '' : 'ghost'}
          onClick={() => setMode('each')}
          style={{ padding: '4px 10px', fontSize: 12 }}
        >
          Per copy
        </button>
        <button
          className={mode === 'total' ? '' : 'ghost'}
          onClick={() => setMode('total')}
          style={{ padding: '4px 10px', fontSize: 12 }}
        >
          Total spent
        </button>
      </div>

      {mode === 'each' ? (
        <div className="copy-list">
          {a.costs.map((v, i) => (
            <div className="copy-row" key={i}>
              <span className="small muted">Copy {i + 1}</span>
              <input
                className="mini"
                style={{ width: 86, textAlign: 'right' }}
                value={v ?? ''}
                // Blank copies are costed at raw market value, so show that
                // rather than a dash -- the placeholder is the actual figure
                // being used, not an absence.
                placeholder={a.raw ? a.raw.toFixed(2) : '0.00'}
                title="Leave blank to assume you paid market value"
                onChange={(e) => setCopy(i, e.target.value)}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="mini"
              style={{ width: 100 }}
              value={bulk}
              placeholder="total paid"
              onChange={(e) => setBulk(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyBulk()}
            />
            <span className="small muted">for {a.qty}</span>
            <button onClick={applyBulk} disabled={bulkEach == null}>Split evenly</button>
          </div>
          {bulkEach != null && (
            <p className="small" style={{ margin: '6px 0 0', color: 'var(--accent)' }}>
              → {money(bulkEach)} per copy. Overwrites anything already entered.
            </p>
          )}
        </>
      )}

      <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'baseline' }}>
        <span style={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
          {money(a.paidTotal)}
        </span>
        <span className="small muted">
          {money(a.paidEach)} each
          {a.assumedCount > 0 && ` · ${a.assumedCount} at market`}
        </span>
        {a.hasCost && (
          <>
            <div className="spacer" />
            <button
              className="ghost small danger"
              onClick={() => onPatch({ costs: [], costTotal: undefined })}
            >
              Clear
            </button>
          </>
        )}
      </div>

      {a.lineProfit != null ? (
        <div className="calc" style={{ marginTop: 10 }}>
          {/* What the whole row is worth if every copy hits the target grade,
              stated before the deductions so the headline number is visible
              without working backwards from the after-fees figure. */}
          <div>
            <span>PSA {a.targetGrade} value</span>
            <span>{money(a.lineGraded)}</span>
          </div>
          {a.qty > 1 && (
            <div className="muted small calc-note">
              <span>{a.qty} × {money(a.gradedPrice)} if every copy hits</span>
              <span />
            </div>
          )}
          {/* Straight after the gross figure it is deducted from, so the two
              read as one step before the costs are taken off. */}
          <div>
            <span>Sale after {Math.round(a.feeRate * 100)}% fees</span>
            <span>{money(a.lineProceeds)}</span>
          </div>
          <div><span>Spent</span><span>{money(a.paidTotal)}</span></div>
          <div><span>Grading</span><span>{money(a.gradingCost * a.qty)}</span></div>
          <div className="tot">
            <span>{a.hasCost ? 'Profit' : 'Profit at market cost'}</span>
            <span className={'verdict ' + verdictOf(a.lineProfit)}>
              {money(a.lineProfit)} ({percent(a.profitRoi)})
            </span>
          </div>
          {/* Without a purchase price this falls back to market value, which
              makes it the same sum as the column beside it. Two panels showing
              one number look broken unless the reason is stated. */}
          {!a.hasCost && (
            <div className="muted small calc-note" style={{ marginTop: 6 }}>
              <span>
                Enter what you paid to see your real profit. Until then this
                assumes market price, so it matches the column on the left.
              </span>
              <span />
            </div>
          )}
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
          Needs a graded comp to work out profit.
        </p>
      )}
    </>
  )
}

// Same thresholds the main verdict uses, applied to the after-fee figure.
function verdictOf(n) {
  if (n == null) return 'unknown'
  if (n >= 50) return 'strong'
  if (n > 0) return 'marginal'
  return 'negative'
}

export default function BacklogTable({
  cards, tiers, settings, onPatch, onRemove, onUsage, onError,
  selected, onToggleSelect, onToggleAll, submissionOf, sizeFor, filtered, onOpenSubmission,
  query, onAdd,
}) {
  const [openId, setOpenId] = useState(null)
  const allSelected = cards.length > 0 && cards.every((c) => selected.has(c.id))
  // Shown in the header so the column says which rate it used.
  const feePct = Math.round(Math.max(0, Math.min(100, Number(settings.sellFeePct ?? 15))))

  if (cards.length === 0) {
    return (
      <div className="panel">
        <div className="empty">
          {filtered ? (
            <>
              <p style={{ fontSize: 15, color: 'var(--dim)' }}>No cards match that filter.</p>
              <p>Your backlog still has everything in it. Only the view is narrowed.</p>
              {query && onAdd && (
                <button className="primary" style={{ marginTop: 12 }} onClick={() => onAdd(query)}>
                  Search for “{query}” to add it
                </button>
              )}
            </>
          ) : (
            <>
              <p style={{ fontSize: 15, color: 'var(--dim)' }}>Nothing in the backlog yet.</p>
              <p>Search for a card you want to grade and it&apos;ll land here.</p>
              {onAdd && (
                <button className="primary" style={{ marginTop: 12 }} onClick={() => onAdd('')}>
                  + Add cards
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                  title={allSelected ? 'Clear selection' : 'Select all shown'}
                />
              </th>
              <th style={{ width: 40 }}></th>
              <th className="card-col">Card</th>
              <th className="num qty-col" title="How many copies of this exact card you own">Qty</th>
              <th>Status</th>
              <th
                className="num grp"
                title="Average of what you paid per copy. Copies you haven't priced count at market value."
              >
                Paid ea.
              </th>
              <th className="num" title="Raw market value of one copy">Raw value</th>
              <th className="grp" title="Chosen from the declared value, which defaults to the expected graded price">Tier</th>
              <th>Target</th>
              <th className="num grp" title="Value of one copy at the target grade">Graded value</th>
              <th
                className="num"
                title="Gain on one copy over what you paid for it, before selling fees. ROI beneath."
              >
                Net ea.
              </th>
              <th
                className="num"
                title={`Profit on one copy after ${feePct}% selling fees, grading and what you paid. ROI beneath.`}
              >
                After fees
              </th>
              <th style={{ width: 34 }}></th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <Row
                key={c.id}
                card={c}
                tiers={tiers}
                settings={settings}
                open={openId === c.id}
                onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                onPatch={(patch) => onPatch(c.id, patch)}
                onRemove={() => onRemove(c.id)}
                onUsage={onUsage}
                onError={onError}
                checked={selected.has(c.id)}
                onCheck={() => onToggleSelect(c.id)}
                submission={submissionOf(c)}
                onOpenSubmission={onOpenSubmission}
                batchSize={sizeFor(c)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({
  card, tiers, settings, open, onToggle, onPatch, onRemove, onUsage, onError,
  checked, onCheck, submission, batchSize, onOpenSubmission,
}) {
  const a = analyzeCard(card, tiers, settings, batchSize)
  const [loadingGrades, setLoadingGrades] = useState(false)
  const nearest = nearestGrade(card.gradedPrices, a.targetGrade)

  async function loadGrades(force = false) {
    setLoadingGrades(true)
    onError(null)
    try {
      const r = await getCard(card.tcgPlayerId, {
        withGraded: true,
        force,
        fallbackQuery: `${card.name} ${card.setName || ''}`.trim(),
      })
      const psa = r.card.graded?.byCompany?.PSA || {}
      const match = r.card.printings.find((p) => p.printing === card.printing)
      onPatch({
        rawPrice: match?.price ?? r.card.marketPrice ?? card.rawPrice,
        priceUpdatedAt: r.card.lastUpdated,
        gradedPrices: Object.fromEntries(Object.entries(psa).map(([g, v]) => [g, v.price])),
        gradedMeta: psa,
        gradedAll: r.card.graded?.byCompany || {},
        gradedFetchedAt: Date.now(),
      })
      if (r.usage) onUsage(r.usage)
    } catch (err) {
      onError(err.message)
    } finally {
      setLoadingGrades(false)
    }
  }

  const status = STATUSES.find((s) => s.id === statusOf(card)) || STATUSES[0]

  return (
    <>
      <tr>
        <td>
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
          />
        </td>
        <td>
          <button
            className="disclose"
            onClick={onToggle}
            title={open ? 'Hide details' : 'Show details'}
          >
            {open ? '−' : '+'}
          </button>
        </td>
        <td className="card-col">
          <div className="card-cell">
            <CardThumb src={card.image} alt={card.name} width={38} />
            <div>
              <div className="cardname">{card.name}</div>
              <div className="cardmeta">
                {card.language === 'japanese' && (
                  <span style={{ color: 'var(--warn)' }}>JP · </span>
                )}
                {card.setName} · #{card.number} · {card.printing} · {card.condition}
              </div>
              {submission && (
                <button
                  className="link-sub"
                  onClick={() => onOpenSubmission?.(submission.id)}
                  title={`Open ${submission.name}`}
                >
                  in {submission.name} →
                </button>
              )}
            </div>
          </div>
        </td>
        <td className="num qty-col">
          <input
            className="mini"
            style={{ width: 38, textAlign: 'center', padding: '4px 2px' }}
            value={card.qty ?? 1}
            onChange={(e) => onPatch({ qty: e.target.value })}
            onBlur={(e) => onPatch({ qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            title="Copies of this card"
          />
        </td>
        <td>
          <span className={'pill ' + status.id} title={status.hint}>{status.label}</span>
        </td>
        <td
          className="num grp"
          title={
            a.assumedCount > 0
              ? `${a.assumedCount} of ${a.qty} assumed at market value. Set them in the expanded row`
              : `Average across ${a.qty} priced cop${a.qty === 1 ? 'y' : 'ies'}`
          }
        >
          {/* Dimmed while it is still an assumption rather than a figure you
              entered, so a real cost basis is visually distinct. */}
          <span className={a.hasCost ? '' : 'muted'}>{money(a.paidEach)}</span>
        </td>
        <td className="num">{money(a.raw)}</td>
        <td className="grp">
          <select
            className="mini"
            value={card.tierId || ''}
            onChange={(e) => onPatch({ tierId: e.target.value || null })}
            style={{ width: 148 }}
            title={`Declared at ${money(a.declared)}`}
          >
            <option value="">
              {a.tier ? `Auto · ${a.tier.name}` : 'Auto · none fits'}
            </option>
            {tiers.map((t) => {
              const min = Number(t.minCards) || 1
              const locked = Number(settings.shipmentSize) < min
              return (
                <option key={t.id} value={t.id}>
                  {t.name} · {money(t.fee)}{locked ? ` (${min}+)` : ''}
                </option>
              )
            })}
          </select>
        </td>
        <td>
          <select
            className="mini"
            value={a.targetGrade}
            onChange={(e) => onPatch({ targetGrade: Number(e.target.value) })}
            /* Wide enough for "PSA 9.5", the longest option -- the previous
               width clipped it and "PSA 10" against the dropdown arrow. */
            style={{ width: 100 }}
          >
            {GRADE_OPTIONS.map((g) => (
              <option key={g} value={g}>PSA {g}</option>
            ))}
          </select>
        </td>
        <td className="num grp">
          {a.gradedPrice != null ? (
            <>
              {money(a.gradedPrice)}
              {a.priceSource && !a.priceSource.exact && (
                <div className="cardmeta" style={{ color: 'var(--warn)' }} title={
                  `No sales in the window you selected, so this falls back to the ${a.priceSource.label}.`
                }>
                  {a.priceSource.label}
                </div>
              )}
            </>
          ) : !card.gradedFetchedAt ? (
            // Never looked up. Say so, and make it one click from here rather
            // than hiding the action inside the expanded row.
            <button
              className="ghost small"
              onClick={() => loadGrades(false)}
              disabled={loadingGrades}
              title="Look up eBay graded sale averages for this card, 2 credits"
            >
              {loadingGrades ? 'Loading…' : 'Fetch comps'}
            </button>
          ) : nearest != null ? (
            // Data exists, just not at the grade you're targeting.
            <button
              className="ghost small"
              onClick={() => onPatch({ targetGrade: nearest })}
              title={`No PSA ${a.targetGrade} sales on record. Switch the target to PSA ${nearest}, which does have a comp.`}
            >
              no PSA {a.targetGrade} → try {nearest}
            </button>
          ) : (
            <span className="muted" title="No eBay graded sales recorded for this card at any grade">
              none
            </span>
          )}
        </td>
        {/*
          Both columns measure against what the copy cost you, which is the
          Paid ea. column two along -- so a row can be read across without the
          baseline changing halfway.

          Copies with no price entered fall back to market value, so an
          uncosted row reads exactly as it did before any of this was set.
        */}
        {/* Held back against the column beside it. This is the gain before
            fees, which is never what you actually receive, so it should not
            compete with the figure that is. */}
        <td
          className={'num verdict second ' + verdictOf(a.upliftVsPaid)}
          title={
            a.roiVsPaid != null
              ? `${money(a.upliftVsPaid)} back on ${money(a.paidEach + a.gradingCost)} ` +
                `tied up per copy: ${money(a.paidEach)} paid plus ${money(a.gradingCost)} grading.`
              : undefined
          }
        >
          {a.upliftVsPaid != null ? money(a.upliftVsPaid) : '–'}
          {a.roiVsPaid != null && <div className="cardmeta">{percent(a.roiVsPaid)}</div>}
        </td>
        <td
          className={'num verdict ' + verdictOf(a.upliftNetVsPaid)}
          title={
            a.proceeds != null
              ? `${money(a.gradedPrice)} less ${Math.round(a.feeRate * 100)}% fees leaves ` +
                `${money(a.proceeds)}, then grading and what you paid come out, per copy.`
              : undefined
          }
        >
          {a.upliftNetVsPaid != null ? money(a.upliftNetVsPaid) : <span className="muted">–</span>}
          {a.roiNetVsPaid != null && <div className="cardmeta">{percent(a.roiNetVsPaid)}</div>}
        </td>
        <td>
          <button
            className="ghost"
            onClick={() => loadGrades(true)}
            disabled={loadingGrades || !card.tcgPlayerId}
            title={
              card.tcgPlayerId
                ? 'Refresh this card only: price and graded sales, 2 credits'
                : 'Not linked to the pricing source yet'
            }
          >
            {loadingGrades ? '…' : '↻'}
          </button>
        </td>
      </tr>

      {open && (
        <tr className="expand">
          <td colSpan={2}></td>
          <td colSpan={11}>
            <div className="detail-grid">
              <div className="detail" style={{ flex: '0 0 auto' }}>
                <label>Card</label>
                <CardThumb src={card.image} alt={card.name} width={150} big />
              </div>

              <div className="detail">
                <label>PSA Target Comps</label>
                {card.gradedPrices && Object.keys(card.gradedPrices).length > 0 ? (
                  <>
                    <div className="grade-grid">
                      {Object.entries(card.gradedPrices)
                        .sort((x, y) => Number(y[0]) - Number(x[0]))
                        .map(([g, flat]) => {
                          const meta = card.gradedMeta?.[g]
                          /*
                            Resolved through the same price basis the breakdown
                            uses, so a tile and the math beside it can never
                            quote two different prices for the same grade. The
                            flat all-sales average stays available in the
                            tooltip, since that is the number this used to show.
                          */
                          const resolved = resolveGradePrice(meta, settings.priceBasis || 'smart')
                          const price = resolved ? resolved.price : flat
                          const differs = resolved && Math.abs(price - flat) >= 0.005
                          return (
                            <button
                              key={g}
                              className={'grade' + (Number(g) === a.targetGrade ? ' sel' : '')}
                              onClick={() => onPatch({ targetGrade: Number(g) })}
                              /* The click hint is appended rather than used as
                                 a fallback: it used to appear only on tiles
                                 with no data, so in the normal case nothing
                                 said these were selectable at all. */
                              title={
                                (meta
                                  ? `${resolved ? resolved.label : 'Average'} · ` +
                                    `${meta.count} eBay sale${meta.count === 1 ? '' : 's'}` +
                                    (differs ? ` · all sales average ${money(flat)}` : '') +
                                    (meta.median ? ` · median ${money(meta.median)}` : '') +
                                    (meta.lastSale ? ` · last ${new Date(meta.lastSale).toLocaleDateString()}` : '') +
                                    '\n'
                                  : '') +
                                (Number(g) === a.targetGrade
                                  ? 'This is your target grade.'
                                  : 'Click to make this your target grade.')
                              }
                            >
                              <div className="g">PSA {g}</div>
                              <div className="p">{money(price, { cents: false })}</div>
                              {meta?.count != null && (
                                <div className="g" style={{ marginTop: 2 }}>
                                  {meta.count} sale{meta.count === 1 ? '' : 's'}
                                </div>
                              )}
                            </button>
                          )
                        })}
                    </div>
                    <button
                      className="ghost small"
                      style={{ marginTop: 8 }}
                      onClick={() => loadGrades(true)}
                      disabled={loadingGrades}
                    >
                      {loadingGrades ? 'Refreshing…' : 'Refresh price + comps (2 credits)'}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="small muted" style={{ margin: '0 0 8px' }}>
                      {card.gradedFetchedAt
                        ? 'No PSA sales recorded for this card. Coverage is patchy, and plenty of cards have none.'
                        : 'Not fetched yet.'}
                    </p>
                    <button onClick={() => loadGrades(false)} disabled={loadingGrades}>
                      {loadingGrades ? 'Loading…' : 'Fetch PSA comps (1 call)'}
                    </button>
                  </>
                )}
              </div>

              <div className="detail">
                {/* "The math" said nothing about which maths. These two columns
                    differ only in what the card is costed at -- market value
                    versus what was actually paid -- so each heading names its
                    own baseline rather than leaving it to be worked out. */}
                <label>Grade or sell raw?</label>
                <p className="small muted" style={{ margin: '0 0 8px' }}>
                  Costed at today's raw value. Ignores what you paid.
                </p>

                {a.gradedPrice == null ? (
                  <div className="calc">
                    <div><span>Sell it raw today</span><span>{money(a.raw)}</span></div>
                    <div><span>Grading cost</span><span>{money(a.gradingCost)}</span></div>
                    <div className="tot">
                      <span>A PSA {a.targetGrade} must clear</span>
                      <span>{money(a.breakEven)}</span>
                    </div>
                    <p className="small muted" style={{ marginTop: 8 }}>
                      No graded comp yet, so this is the bar it has to beat rather than a
                      prediction.
                    </p>
                  </div>
                ) : (
                  <div className="calc">
                    {/* Built up line by line so every deduction is visible and
                        the figures add up to the total on screen. */}
                    {/* The column heading already says this is the grade-and-sell
                        case, so a second header repeating it was just noise. */}
                    <div>
                      <span>PSA {a.targetGrade} sells for</span>
                      <span>{money(a.gradedPrice)}</span>
                    </div>
                    {/* The provenance line that sat here is gone. The comps
                        tiles above still carry it on hover, and the warning
                        below still fires when a price falls back off the basis
                        you chose -- so the cases that need saying still get
                        said, without a line on every row. */}
                    <div>
                      <span>Selling fees ({Math.round(a.feeRate * 100)}%)</span>
                      <span>−{money(a.gradedPrice * a.feeRate)}</span>
                    </div>
                    {a.tierMissing ? (
                      <div>
                        <span className="verdict negative">No tier covers {money(a.declared)}</span>
                        <span className="verdict negative">?</span>
                      </div>
                    ) : (
                      <div>
                        <span>{a.tier.name} fee</span><span>−{money(a.fee)}</span>
                      </div>
                    )}
                    {/*
                      The card itself is the last deduction, so the column ends
                      on a single answer instead of handing off to a second
                      section.

                      Deducted at today's raw value rather than what was paid,
                      because this panel answers "is grading worth it" -- and
                      the alternative to grading is selling raw today, whatever
                      the card originally cost. That also keeps it consistent
                      with the After fees column, which uses the same baseline.
                    */}
                    <div>
                      <span>Raw value</span>
                      <span>−{money(a.raw)}</span>
                    </div>
                    <div className="tot">
                      <span>Profit</span>
                      <span className={'verdict ' + verdictOf(a.upliftNet)}>
                        {money(a.upliftNet)} ({percent(a.roiNet)})
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="detail">
                <label>What this copy made you</label>
                <p className="small muted" style={{ margin: '0 0 8px' }}>
                  Costed at what you actually paid.
                </p>
                <CostBasis card={card} a={a} onPatch={onPatch} />
              </div>

              <div className="detail">
                <label>Notes</label>
                <textarea
                  rows={4}
                  value={card.notes || ''}
                  placeholder="Centering, surface, submission number…"
                  onChange={(e) => onPatch({ notes: e.target.value })}
                />
                <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                  <span className="small muted">
                    Added {new Date(card.addedAt).toLocaleDateString()}
                  </span>
                  <button className="danger" onClick={onRemove}>Remove</button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
