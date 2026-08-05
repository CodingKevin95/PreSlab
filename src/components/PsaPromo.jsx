import React from 'react'

/**
 * PSA referral offer, shown on every tab.
 *
 * Deliberately one line. It was two when it lived on the submissions tab
 * alone, which is affordable for something you meet once; on every page that
 * weight turns into something people learn to skip past, and it would push the
 * actual content down on every view.
 *
 * Styled as an offer -- dashed and tinted -- so it cannot be mistaken for one
 * of the app's own figures or a system message. Everything around it is
 * calculated prices, and a promo that blended in would undermine confidence in
 * the numbers beside it.
 *
 * The new-customer condition stays on its face rather than in small print: a
 * discount someone only discovers is invalid at PSA's checkout is worse than
 * never having been offered one, and they would blame this app rather than PSA.
 */
export default function PsaPromo() {
  return (
    <div className="promo">
      <b>First PSA submission?</b> Use code{' '}
      <code className="promo-code">Yuri25</code> at checkout to save $25
      <span className="muted"> · new account/email only</span>
    </div>
  )
}
