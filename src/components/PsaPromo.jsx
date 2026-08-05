import React from 'react'

/**
 * PSA referral offer, shown on every tab.
 *
 * No container. Two attempts at one -- a dashed box, then a bordered strip --
 * both read as something bolted onto the page, and stretched across a wide
 * screen the strip became a letterbox with its content pinned to either end
 * and nothing in between.
 *
 * A single quiet line avoids all of it. It cannot be mistaken for the app's own
 * figures because it is plainly a sentence rather than a number in a panel, and
 * being unobtrusive is what lets it sit on every tab without wearing thin.
 *
 * The new-customer condition stays in the sentence. A discount someone only
 * discovers is invalid at PSA's checkout is worse than never having been
 * offered one, and they would blame this app rather than PSA.
 */
export default function PsaPromo() {
  return (
    <p className="promo">
      Save <b>$25</b> on your first PSA submission with code{' '}
      <code className="promo-code">Yuri25</code> — new accounts only
    </p>
  )
}
