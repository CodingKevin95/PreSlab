import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  analyzeCard, money, percent, qtyOf, submissionUnits, gradeScenarios,
  priceAsOf, agoLabel, SUBMISSION_STATUSES, tierForDeclaredValue, statusIdOf,
} from '../lib/psa'
import CardThumb from './CardThumb'
import SearchPanel from './SearchPanel'

export default function SubmissionsPanel({
  submissions, cards, tiers, settings,
  onPatchSubmission, onDeleteSubmission, onRemoveCards, onGoToBacklog,
  onAddCard, onNewSubmission, qtyOf, adding, onUsage, onError,
  focusId, onFocused,
}) {
  const [q, setQ] = useState('')

  /*
    Identifies the batch itself -- its name and its submission number -- and
    deliberately not the cards in it. Filtering the cards is what the box inside
    each submission does; this one answers "which of these is 15249687".

    Same rule as the other filters: every word must appear somewhere, so extra
    words narrow rather than broaden.
  */
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = useMemo(() => {
    if (!terms.length) return submissions
    return submissions.filter((sub) => {
      const hay = [sub.name, sub.tracking].filter(Boolean).join(' ').toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [submissions, q])

  if (submissions.length === 0) {
    return (
      <div className="panel">
        <div className="empty">
          <p style={{ fontSize: 15, color: 'var(--dim)' }}>No submissions yet.</p>
          <p>
            Start one here and search for cards inside it, or go to <b>Backlog</b>,
            tick what you want to send and choose <b>Add to submission</b>.
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            {onNewSubmission && (
              <button className="primary" onClick={onNewSubmission}>New submission</button>
            )}
            <button onClick={onGoToBacklog}>Open backlog</button>
          </div>
        </div>
      </div>
    )
  }

  function exportAll() {
    const rows = [
      [`All submissions — exported ${new Date().toLocaleString()}`],
      [],
      ['Submission', 'Status', ...CSV_HEADERS],
    ]
    for (const s of submissions) {
      const mine = cards.filter((c) => c.submissionId === s.id)
      const size = submissionUnits(s.id, cards)
      const label = SUBMISSION_STATUSES.find((x) => x.id === statusIdOf(s))?.label || statusIdOf(s)
      for (const card of mine) {
        rows.push([s.name, label, ...csvRow(card, analyzeCard(card, tiers, settings, size))])
      }
    }
    downloadCsv(`all-submissions-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        {onNewSubmission && (
          <button className="primary" onClick={onNewSubmission}>New submission</button>
        )}
        {/* Only worth showing once there is something to search through. */}
        {submissions.length > 1 && (
          <>
            <input
              className="mini"
              style={{ width: 230 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name or submission number…"
            />
            {terms.length > 0 && (
              <>
                <button className="ghost small" onClick={() => setQ('')} title="Clear">Clear</button>
                <span className="small muted">{shown.length} of {submissions.length}</span>
              </>
            )}
          </>
        )}
        <div className="spacer" />
        {submissions.length > 1 && (
          <button onClick={exportAll} title="Every submission in one spreadsheet">
            Export all {submissions.length} as CSV
          </button>
        )}
      </div>

      {/* Distinct from having no submissions at all, which is handled above. */}
      {terms.length > 0 && shown.length === 0 && (
        <div className="panel">
          <div className="empty">
            <p>No submission matches that.</p>
            <p className="small">
              Searches batch names and submission numbers. To find a card, use the
              filter inside a submission.
            </p>
          </div>
        </div>
      )}

      {shown.map((s) => (
        <Submission
          key={s.id}
          sub={s}
          cards={cards.filter((c) => c.submissionId === s.id)}
          allCards={cards}
          tiers={tiers}
          settings={settings}
          onPatch={(patch) => onPatchSubmission(s.id, patch)}
          onDelete={() => onDeleteSubmission(s.id)}
          onRemoveCards={onRemoveCards}
          onAddCard={onAddCard}
          qtyOf={qtyOf}
          adding={adding}
          onUsage={onUsage}
          onError={onError}
          focused={focusId === s.id}
          onFocused={onFocused}
        />
      ))}
    </>
  )
}

/**
 * Escapes a value for CSV. Card names contain commas and the occasional
 * quote, so this is not optional.
 */
function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(filename, rows) {
  // CRLF and a BOM so Excel opens it correctly and does not mangle accents.
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const CSV_HEADERS = [
  'Card', 'Set', 'Number', 'Printing', 'Condition', 'Language', 'Qty',
  'Paid ea', 'Paid total', 'Raw ea', 'Raw total',
  'Declared ea', 'Tier', 'Tier fee', 'Grading cost total',
  'Target grade', 'PSA ea', 'PSA total', 'Sale after fees ea',
  'Net vs paid ea', 'Profit ea', 'Profit total', 'ROI %',
]

function csvRow(card, a) {
  const n = (v, dp = 2) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(dp))
  return [
    card.name, card.setName, card.number, card.printing, card.condition,
    card.language === 'japanese' ? 'Japanese' : 'English',
    a.qty,
    n(a.paidEach), n(a.paidTotal),
    n(a.raw), n(a.lineRaw),
    n(a.declared), a.tier ? a.tier.name : 'none', n(a.fee), n(a.gradingCost * a.qty),
    `PSA ${a.targetGrade}`, n(a.gradedPrice), n(a.lineGraded), n(a.proceeds),
    n(a.upliftVsPaid), n(a.lineProfit != null ? a.lineProfit / a.qty : null), n(a.lineProfit),
    a.profitRoi != null ? (a.profitRoi * 100).toFixed(1) : '',
  ]
}

// Same thresholds the backlog uses, so a figure reads the same colour in both.
function verdictOf(n) {
  if (n == null) return 'unknown'
  if (n >= 50) return 'strong'
  if (n > 0) return 'marginal'
  return 'negative'
}

function Submission({
  sub, cards, allCards, tiers, settings, onPatch, onDelete, onRemoveCards,
  onAddCard, qtyOf, adding, onUsage, onError,
  focused, onFocused,
}) {
  const [open, setOpen] = useState(true)
  const [openCase, setOpenCase] = useState(null)
  const [q, setQ] = useState('')
  const ref = useRef(null)

  // Arriving from a backlog row: scroll this one into view and flash it, so
  // it is obvious which submission you landed on when there are several.
  useEffect(() => {
    if (!focused || !ref.current) return
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setOpen(true)
    const t = setTimeout(() => onFocused?.(), 1400)
    return () => clearTimeout(t)
  }, [focused, onFocused])

  const units = submissionUnits(sub.id, allCards)
  const analyses = cards.map((c) => ({ card: c, a: analyzeCard(c, tiers, settings, units) }))

  /*
    Narrows the rows on show and nothing else. Every figure above the table --
    the totals, the scenarios, the tier this batch qualifies for -- describes
    what is actually being sent, so filtering must not reach them. A profit
    total that quietly followed the search box would be a different number
    wearing the same label.

    Same matching as the backlog: every word has to appear somewhere on the
    card, so extra words narrow rather than broaden.
  */
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = terms.length
    ? analyses.filter(({ card }) => {
        const hay = [
          card.name, card.setName, card.number, card.rarity,
          card.printing, card.condition, card.notes,
        ].filter(Boolean).join(' ').toLowerCase()
        return terms.every((t) => hay.includes(t))
      })
    : analyses

  const totals = analyses.reduce(
    (acc, { a }) => ({
      raw: acc.raw + a.lineRaw,
      cost: acc.cost + a.lineCost,
      graded: acc.graded + (a.lineGraded ?? 0),
      uplift: acc.uplift + (a.lineUplift ?? 0),
      upliftNet: acc.upliftNet + (a.lineUpliftNet ?? 0),
      spent: acc.spent + a.paidTotal,
      assumed: acc.assumed + a.assumedCount,
      profit: acc.profit + (a.lineProfit ?? 0),
      withComps: acc.withComps + (a.gradedPrice != null ? 1 : 0),
    }),
    { raw: 0, cost: 0, graded: 0, uplift: 0, upliftNet: 0, spent: 0, assumed: 0, profit: 0, withComps: 0 }
  )

  // Which tiers this batch unlocks purely by being big enough.
  const unlocked = tiers.filter((t) => units >= (Number(t.minCards) || 1))
  const blocked = tiers.filter((t) => units < (Number(t.minCards) || 1))
  const nextTier = blocked.sort((a, b) => Number(a.minCards) - Number(b.minCards))[0]

  const status = SUBMISSION_STATUSES.find((s) => s.id === statusIdOf(sub)) || SUBMISSION_STATUSES[0]

  const priced = priceAsOf(cards)

  function exportCsv() {
    const rows = [
      [`Submission: ${sub.name}`],
      [`Status: ${status.label}`, `Cards: ${units}`, `Submission #: ${sub.tracking || ''}`],
      [`Exported: ${new Date().toLocaleString()}`],
      [],
      CSV_HEADERS,
      ...analyses.map(({ card, a }) => csvRow(card, a)),
      [],
      // A totals line, so the file stands on its own without re-deriving sums.
      ['TOTAL', '', '', '', '', '', units,
        '', totals.spent.toFixed(2), '', totals.raw.toFixed(2),
        '', '', '', totals.cost.toFixed(2),
        '', '', totals.graded.toFixed(2), '',
        '', '', totals.profit.toFixed(2), ''],
    ]
    const safe = (sub.name || 'submission').replace(/[^\w\-]+/g, '-').toLowerCase()
    downloadCsv(`${safe}-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  // Only meaningful once a gem rate is entered.
  const scen = sub.gemRate != null && String(sub.gemRate).trim() !== ''
    ? gradeScenarios(cards, tiers, settings, units, sub.gemRate)
    : null

  return (
    <div className={'panel' + (focused ? ' flash' : '')} ref={ref}>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <button
          className="disclose"
          onClick={() => setOpen(!open)}
          style={{ marginTop: 2 }}
          title={open ? 'Collapse this submission' : 'Expand this submission'}
        >
          {open ? '−' : '+'}
        </button>

        <div className="grow">
          <input
            value={sub.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            style={{ fontWeight: 600, fontSize: 15, border: '1px solid transparent', background: 'transparent', padding: '2px 4px' }}
          />
          <div className="cardmeta" style={{ paddingLeft: 5 }}>
            {units} card{units === 1 ? '' : 's'} · {cards.length} unique ·
            created {new Date(sub.createdAt).toLocaleDateString()}
          </div>
        </div>

        <select
          className="mini"
          value={statusIdOf(sub)}
          onChange={(e) => onPatch({ status: e.target.value })}
          style={{ width: 130 }}
          title={status.hint}
        >
          {SUBMISSION_STATUSES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {!open && (
        <div className="sub-peek">
          {cards.slice(0, 3).map((c) => (
            <span className="peek-card" key={c.id}>
              <CardThumb src={c.image} alt={c.name} width={22} />
              <span className="peek-name">{c.name}</span>
            </span>
          ))}
          {cards.length > 3 && (
            <span className="small muted">+{cards.length - 3} more</span>
          )}
          {cards.length === 0 && <span className="small muted">No cards yet</span>}
          <div className="spacer" />
          {sub.tracking && <span className="peek-num">#{sub.tracking}</span>}
        </div>
      )}

      {open && (
      <>
      <div className="sec">
        <div className="sec-head"><span className="micro">If every card hits its target</span></div>
        <div className="stats">
        <Mini k="Cards" v={String(units)} />
        <Mini
          k="Spent"
          v={money(totals.spent, { cents: false })}
          n={totals.assumed > 0 ? `${totals.assumed} at market value` : 'what you paid'}
        />
        <Mini
          k="Raw value"
          v={money(totals.raw, { cents: false })}
          n={priced ? `priced ${agoLabel(priced.oldest)}` : undefined}
        />
        <Mini k="Grading cost" v={money(totals.cost, { cents: false })} n="PSA fees" />
        <Mini k="PSA value" v={money(totals.graded, { cents: false })} n={`at target grade · ${totals.withComps}/${cards.length} have comps`} />
        {/* This is the ceiling, not a forecast -- it assumes every card comes
            back at its target grade. The scenario tiles below temper it. */}
        <Mini
          k="Profit"
          v={money(totals.profit, { cents: false })}
          n="if every card hits its target grade · after fees, grading and what you paid"
          tone={totals.profit > 0 ? 'good' : totals.profit < 0 ? 'bad' : null}
        />
        </div>
      </div>

      {/*
        Everything above assumes the target grade comes back. That is the best
        case, not the likely one, so a gem rate turns it into a range.
      */}
      <div className="sec">
        <div className="sec-head">
          <span className="micro">If some of them miss</span>
          <input
            className="mini"
            style={{ width: 58, textAlign: 'right' }}
            value={sub.gemRate ?? ''}
            placeholder="%"
            onChange={(e) => onPatch({ gemRate: e.target.value })}
            title="Share of these cards you expect to come back at the target grade"
          />
          <span className="small muted">
            % hit their target
            {scen && scen.priced > 0 &&
              ` · ${scen.hits} of ${scen.priced} — the range is which ${scen.hits === 1 ? 'one' : 'ones'}`}
          </span>
        </div>

      {scen && (
        <>
          <div className="stats">
            <Mini
              k="Worst case"
              v={money(scen.worst, { cents: false })}
              n={
                scen.missesInWorst.length
                  ? `your best cards miss: ${scen.missesInWorst.slice(0, 2).join(', ')}`
                  : 'every card hits'
              }
              tone={scen.worst > 0 ? 'good' : scen.worst < 0 ? 'bad' : null}
              open={openCase === 'worst'}
              onClick={() => setOpenCase(openCase === 'worst' ? null : 'worst')}
            />
            <Mini
              k="Expected"
              v={money(scen.expected, { cents: false })}
              n={`each card at ${Math.round(Number(sub.gemRate) || 0)}%`}
              tone={scen.expected > 0 ? 'good' : scen.expected < 0 ? 'bad' : null}
              open={openCase === 'expected'}
              onClick={() => setOpenCase(openCase === 'expected' ? null : 'expected')}
            />
            <Mini
              k="Best case"
              v={money(scen.best, { cents: false })}
              n={
                scen.missesInBest.length
                  ? `only your cheapest miss: ${scen.missesInBest.slice(0, 2).join(', ')}`
                  : 'every card hits'
              }
              tone={scen.best > 0 ? 'good' : scen.best < 0 ? 'bad' : null}
              open={openCase === 'best'}
              onClick={() => setOpenCase(openCase === 'best' ? null : 'best')}
            />
          </div>

          {openCase && (
            <div className="scen-break">
              <div className="scen-row scen-head">
                <span>
                  {openCase === 'worst' ? 'Worst case' : openCase === 'best' ? 'Best case' : 'Expected'}
                  {' — '}
                  {openCase === 'expected'
                    ? `every card blended at ${Math.round(Number(sub.gemRate) || 0)}%`
                    : `${scen.hits} of ${scen.priced} hit the target`}
                </span>
                <span>profit</span>
              </div>
              {scen.rows[openCase].map((r, i) => (
                <div className="scen-row" key={i}>
                  <span>
                    {r.qty > 1 && <b>{r.qty}× </b>}
                    {r.name}
                    {r.grade != null && (
                      <span className={'pill ' + (r.hit ? 'submitted' : 'backlog')} style={{ marginLeft: 8 }}>
                        PSA {r.grade}
                      </span>
                    )}
                    {r.blend && (
                      <span className="small muted" style={{ marginLeft: 8 }}>
                        {r.blend.single != null
                          ? `PSA ${r.blend.single} — no lower comp to fall to`
                          : `${Math.round(r.blend.p * 100)}% PSA ${r.blend.target} · ` +
                            `${Math.round((1 - r.blend.p) * 100)}% PSA ${r.blend.fallback}`}
                      </span>
                    )}
                  </span>
                  <span className={'verdict ' + verdictOf(r.value)}>{money(r.value)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {scen && scen.noFloor > 0 && (
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {scen.noFloor} card{scen.noFloor === 1 ? ' has' : 's have'} no comp below the target
          grade, so {scen.noFloor === 1 ? 'it is' : 'they are'} counted at best case in every
          scenario rather than guessed at.
        </p>
      )}
      </div>

      {nextTier && (
        <div className="banner info" style={{ marginTop: 12, marginBottom: 0 }}>
          Add {Number(nextTier.minCards) - units} more card
          {Number(nextTier.minCards) - units === 1 ? '' : 's'} to unlock
          <b> {nextTier.name}</b> at {money(nextTier.fee)}/card
          {unlocked.length > 0 && (
            <> — you&apos;re currently paying {money(
              Math.min(...unlocked.map((t) => Number(t.fee)))
            )}/card at best.</>
          )}
        </div>
      )}

          {/*
            Adds straight into this batch rather than the loose backlog. The
            same component the backlog uses, so a card added here is fetched,
            priced and deduplicated exactly as it would be there -- and appears
            in the backlog too, since a submitted card is a backlog card
            carrying this submission's id.
          */}
          {onAddCard && (
            <div className="sec">
              <div className="sec-head">
                <span className="micro">Add cards to this submission</span>
              </div>
              <SearchPanel
                bare
                onAdd={(card, printing) => onAddCard(card, printing, sub.id)}
                qtyOf={qtyOf}
                adding={adding}
                onUsage={onUsage}
                onError={onError}
              />
            </div>
          )}

          <div className="sec">
          <div className="sec-head">
            <span className="micro">Cards in this submission</span>
            <input
              className="mini"
              style={{ width: 190 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter these cards…"
            />
            {q.trim() && (
              <button className="ghost small" onClick={() => setQ('')} title="Clear filter">
                Clear
              </button>
            )}
            <div className="spacer" />
            <span className="small muted">
              {terms.length
                ? `${shown.length} of ${analyses.length} shown`
                : `${units} card${units === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  {/* Same columns, same order as the backlog table -- a card
                      should not look different depending on where you view it.
                      Status is omitted because everything here is submitted. */}
                  <th className="card-col">Card</th>
                  <th className="num qty-col">Qty</th>
                  <th
                    className="num grp"
                    title="Average of what you paid per copy. Copies you haven't priced count at market value."
                  >
                    Paid ea.
                  </th>
                  <th className="num" title="Raw market value of one copy">Raw value</th>
                  <th className="grp">Tier</th>
                  <th>Target</th>
                  <th className="num grp" title="Value of one copy at the target grade">Graded value</th>
                  {/* Measured against what you paid, not market value: the
                      grade-or-sell decision is already made for these cards. */}
                  <th
                    className="num"
                    title="Gain on one copy over what you paid for it, before selling fees. ROI beneath."
                  >
                    Net ea.
                  </th>
                  <th
                    className="num"
                    title="Profit on one copy after selling fees, grading and what you paid. ROI beneath."
                  >
                    Profit ea.
                  </th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ card, a }) => (
                  <tr key={card.id}>
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
                        </div>
                      </div>
                    </td>
                    <td className="num qty-col">{a.qty}</td>
                    <td
                      className="num grp"
                      title={
                        a.assumedCount > 0
                          ? `${a.assumedCount} of ${a.qty} assumed at market value`
                          : `Average across ${a.qty} priced cop${a.qty === 1 ? 'y' : 'ies'}`
                      }
                    >
                      {/* Dimmed while it is still an assumption rather than a
                          figure you entered. */}
                      <span className={a.hasCost ? '' : 'muted'}>{money(a.paidEach)}</span>
                    </td>
                    <td className="num">{money(a.raw)}</td>
                    <td className="grp">
                      <span className="pill">{a.tier ? a.tier.name : 'none'}</span>
                    </td>
                    <td>PSA {a.targetGrade}</td>
                    <td className="num grp">
                      {a.gradedPrice != null ? money(a.gradedPrice) : <span className="muted">—</span>}
                    </td>
                    <td className={'num verdict second ' + verdictOf(a.upliftVsPaid)}>
                      {a.upliftVsPaid != null ? money(a.upliftVsPaid) : '—'}
                      {a.roiVsPaid != null && (
                        <div className="cardmeta">{percent(a.roiVsPaid)}</div>
                      )}
                    </td>
                    <td
                      className={'num verdict ' + verdictOf(a.lineProfit)}
                      title={
                        a.proceeds != null
                          ? `${money(a.gradedPrice)} less ${Math.round(a.feeRate * 100)}% fees, ` +
                            `grading and the ${money(a.paidEach)} you paid`
                          : undefined
                      }
                    >
                      {a.lineProfit != null ? money(a.lineProfit / a.qty) : '—'}
                      {a.profitRoi != null && (
                        <div className="cardmeta">{percent(a.profitRoi)}</div>
                      )}
                    </td>
                    <td>
                      <button
                        className="ghost"
                        title="Send back to the backlog"
                        onClick={() => onRemoveCards([card.id])}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={10} className="muted small" style={{ textAlign: 'center', padding: 24 }}>
                      {terms.length
                        ? 'No cards here match that filter — the batch itself is unchanged.'
                        : 'Empty. Search above, or tick cards in the backlog and add them here.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </div>

          <div className="row wrap" style={{ marginTop: 28, gap: 12 }}>
            {/* Still stored under `tracking`, which is what every existing
                submission already uses -- renaming the key would orphan the
                numbers people have entered. */}
            <div style={{ width: 260 }}>
              <label className="small muted">Submission number</label>
              <input
                value={sub.tracking || ''}
                placeholder="PSA order #"
                onChange={(e) => onPatch({ tracking: e.target.value })}
              />
            </div>
            <div className="grow" />
            <button
              style={{ alignSelf: 'flex-end' }}
              onClick={exportCsv}
              disabled={cards.length === 0}
              title="Download this submission as a spreadsheet"
            >
              Export CSV
            </button>
            <button
              className="danger"
              style={{ alignSelf: 'flex-end' }}
              onClick={onDelete}
              title="Delete this submission — its cards return to the backlog"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Mini({ k, v, n, tone, open, onClick }) {
  return (
    <div
      className={'stat' + (onClick ? ' stat-btn' : '') + (open ? ' stat-open' : '')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      <div className="k">
        {k}
        {onClick && <span className="stat-caret">{open ? '−' : '+'}</span>}
      </div>
      <div className={'v' + (tone ? ' ' + tone : '')} style={{ fontSize: 18 }}>{v}</div>
      {n && <div className="n">{n}</div>}
    </div>
  )
}
