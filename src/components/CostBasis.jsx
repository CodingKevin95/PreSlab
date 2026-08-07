import React, { useState } from 'react'
import { money, percent, verdictOf } from '../lib/psa'

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
export default function CostBasis({ card, a, onPatch }) {
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


