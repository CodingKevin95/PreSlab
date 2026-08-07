
/**
 * Front door for people arriving at the link cold.
 *
 * Built the way a product page is built rather than the way the app is: one
 * idea per screen, type doing the work, almost no chrome. That formula suits a
 * page whose whole job is to land a single point, and would be actively bad
 * inside the tool, where the point is to see hundreds of rows at once.
 *
 * Everything stated here is something the app actually does. A front door that
 * promises more than the room behind it just moves the disappointment later.
 */
export default function Landing() {
  return (
    <div className="land">
      <header className="land-nav">
        <span className="land-mark">PreSlab</span>
        <a className="land-cta-sm" href="/app">Open</a>
      </header>

      <section className="land-hero">
        <h1>Is it worth grading?</h1>
        <p className="land-lede">
          Answer it before you pay the fee, not after the card comes back.
        </p>
        <a className="land-cta" href="/app">Open PreSlab</a>
        <p className="land-fine">Free · nothing to install · no account needed</p>
      </section>

      <section className="land-panel">
        <p className="land-eyebrow">The maths</p>
        <h2>Every deduction, in the open.</h2>
        <p className="land-body">
          Not a verdict you have to trust. The graded price, the selling fee, the
          tier fee and what the card is worth raw, laid out so you can see where
          the number came from and disagree with it.
        </p>

        {/* A real card at real prices. An invented example would be the one part
            of this page the product cannot back up. */}
        <div className="land-calc">
          <div><span>PSA 10 sells for</span><span>$1,462.50</span></div>
          <div><span>Selling fees (15%)</span><span>−$219.38</span></div>
          <div><span>Regular tier fee</span><span>−$74.99</span></div>
          <div><span>Raw value</span><span>−$575.00</span></div>
          <div className="land-calc-tot">
            <span>Profit</span><span className="pos">$593.13</span>
          </div>
        </div>
      </section>

      <section className="land-panel">
        <p className="land-eyebrow">Real comps</p>
        <h2>Prices from sales that happened.</h2>
        <p className="land-body">
          PSA 10 values come from actual eBay sales, with the sale count and how
          recent they are shown next to every figure. A price built on three sales
          is not the same claim as one built on three hundred, and the app says
          which you are looking at.
        </p>
      </section>

      <section className="land-panel">
        <p className="land-eyebrow">Submissions</p>
        <h2>Not every card comes back a 10.</h2>
        <p className="land-body">
          Group cards into a submission and set the gem rate you actually expect.
          You get the worst case, the likely case and the best case, because
          planning on everything hitting a 10 is how a profitable submission turns
          into a losing one.
        </p>
      </section>

      <section className="land-panel">
        <p className="land-eyebrow">Your data</p>
        <h2>Stays on your machine.</h2>
        <p className="land-body">
          Your cards, what you paid and your notes live in your browser. Nothing
          is uploaded, there is no account, and you can export the lot to a file
          whenever you want.
        </p>
      </section>

      <section className="land-hero land-end">
        <h2 className="land-close">Stop guessing at the counter.</h2>
        <a className="land-cta" href="/app">Open PreSlab</a>
      </section>

      <footer className="land-foot">
        <span>PreSlab</span>
        <span className="land-fine">
          Prices from PokemonPriceTracker · not affiliated with PSA or Pokémon
        </span>
      </footer>
    </div>
  )
}
