import CardThumb from './CardThumb'
import { qtyOf } from '../lib/psa'

/**
 * Asks which kind of removal was meant.
 *
 * The cross used to do one thing silently: send the card back to the backlog.
 * That is the right default and the wrong assumption, because the other reason
 * for pressing it is that the card should not be tracked at all, and doing the
 * gentle thing left a row to find and delete somewhere else.
 *
 * Deleting is stated in terms of what is actually lost -- the purchase prices,
 * which are typed by hand and are the only thing here that cannot be fetched
 * again -- rather than as a generic warning.
 */
export default function RemoveCardDialog({ card, onBacklog, onDelete, onCancel }) {
  if (!card) return null

  const qty = qtyOf(card)
  const priced = (Array.isArray(card.costs) ? card.costs : [])
    .filter((v) => v !== '' && v != null).length

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 470 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 15 }}>Remove this card?</h2>
        <p className="sub" style={{ marginBottom: 16 }}>
          It is in this submission. Choose where it goes.
        </p>

        <div className="card-cell" style={{ marginBottom: 18 }}>
          <CardThumb src={card.image} alt={card.name} width={38} />
          <div>
            <div className="cardname">{card.name}</div>
            <div className="cardmeta">
              {card.setName} · #{card.number} · {card.printing}
              {qty > 1 ? ` · ${qty} copies` : ''}
            </div>
          </div>
        </div>

        <div className="row" style={{ flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
          <button className="primary" onClick={onBacklog}>
            Move back to the backlog
          </button>
          <p className="small muted" style={{ margin: '-4px 0 6px' }}>
            Keeps the card and what you paid. It rejoins any copies you did not send.
          </p>

          <button className="danger" onClick={onDelete}>
            Delete it completely
          </button>
          <p className="small muted" style={{ margin: '-4px 0 0' }}>
            {priced > 0
              ? `Removes it everywhere, including ${priced === qty ? 'the' : priced} purchase price${priced === 1 ? '' : 's'} you entered. Prices can be fetched again; what you paid cannot.`
              : 'Removes it everywhere. Nothing you typed is lost, since no purchase price is recorded.'}
          </p>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <div className="grow" />
          <button className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
