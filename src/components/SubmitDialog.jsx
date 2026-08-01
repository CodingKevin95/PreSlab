import React, { useState } from 'react'
import { money, qtyOf } from '../lib/psa'
import CardThumb from './CardThumb'

/**
 * Chooses how many copies of each selected card actually go in the batch.
 *
 * Owning four of something and sending two is normal, so the row splits: the
 * copies you send become their own row inside the submission and the rest stay
 * in the backlog.
 */
export default function SubmitDialog({ cards, targetName, onConfirm, onCancel }) {
  const [picks, setPicks] = useState(() =>
    Object.fromEntries(cards.map((c) => [c.id, qtyOf(c)]))
  )

  const setPick = (id, v, max) =>
    setPicks((p) => ({ ...p, [id]: Math.max(0, Math.min(max, v)) }))

  const totalUnits = Object.values(picks).reduce((n, v) => n + v, 0)
  const rowsSending = cards.filter((c) => picks[c.id] > 0).length
  const anySplit = cards.some((c) => picks[c.id] > 0 && picks[c.id] < qtyOf(c))

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 4px', fontSize: 15 }}>How many go in {targetName}?</h2>
        <p className="sub" style={{ marginBottom: 16 }}>
          Send some and keep the rest — anything you hold back stays in the backlog.
        </p>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Card</th>
                <th className="num">Own</th>
                <th className="num" style={{ width: 130 }}>Send</th>
                <th className="num">Keep</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => {
                const own = qtyOf(c)
                const send = picks[c.id]
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="card-cell">
                        <CardThumb src={c.image} alt={c.name} width={30} />
                        <div>
                          <div className="cardname">{c.name}</div>
                          <div className="cardmeta">
                            {c.setName} · {c.printing} · {money(c.rawPrice)} ea.
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{own}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <button
                          className="ghost"
                          onClick={() => setPick(c.id, send - 1, own)}
                          disabled={send <= 0}
                        >
                          −
                        </button>
                        <input
                          className="mini"
                          style={{ width: 46, textAlign: 'center' }}
                          value={send}
                          onChange={(e) =>
                            setPick(c.id, parseInt(e.target.value, 10) || 0, own)
                          }
                        />
                        <button
                          className="ghost"
                          onClick={() => setPick(c.id, send + 1, own)}
                          disabled={send >= own}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="num muted">{own - send}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {anySplit && (
          <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Split rows keep their own prices and comps, so the copies you hold back
            stay tracked exactly as they are now.
          </p>
        )}

        <div className="row" style={{ marginTop: 18 }}>
          <span className="small muted">
            {totalUnits} card{totalUnits === 1 ? '' : 's'} across {rowsSending} row
            {rowsSending === 1 ? '' : 's'}
          </span>
          <div className="spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            disabled={totalUnits === 0}
            onClick={() => onConfirm(cards.map((c) => ({ id: c.id, sendQty: picks[c.id] })))}
          >
            Add {totalUnits} card{totalUnits === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
