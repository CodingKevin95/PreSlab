import React from 'react'

/**
 * PSA referral offer, shown on every tab.
 *
 * The job is to stay clearly separate from the app's own figures without
 * looking like an advert bolted on. A dashed border did the first part and
 * failed the second -- dashes read as cheap, and everything else on screen is
 * solid, so it stood out as the one element that did not belong.
 *
 * A small label does the same work quietly: it says what this is, so the box
 * itself can be built like every other surface in the app.
 *
 * The new-customer condition stays on its face rather than in small print. A
 * discount someone only discovers is invalid at PSA's checkout is worse than
 * never having been offered one, and they would blame this app rather than PSA.
 */
export default function PsaPromo() {
  return (
    <div className="promo">
      <span className="promo-tag">Offer</span>
      <span className="promo-text">
        Save <b>$25</b> on your first PSA submission with code
      </span>
      <code className="promo-code">Yuri25</code>
      <span className="promo-note">New accounts only</span>
    </div>
  )
}
