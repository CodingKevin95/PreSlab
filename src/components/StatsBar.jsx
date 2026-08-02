import React from 'react'
import { money, agoLabel } from '../lib/psa'

export default function StatsBar({ roll }) {
  const net = roll.upliftTotal
  return (
    <div className="stats">
      <Stat
        k="Cards"
        v={String(roll.count)}
        n={roll.lines !== roll.count ? `${roll.lines} unique` : 'in backlog'}
      />
      <Stat
        k="Spent"
        v={money(roll.spentTotal, { cents: false })}
        n={
          roll.assumedUnits > 0
            ? `${roll.assumedUnits} of ${roll.count} at market value`
            : 'what you paid'
        }
      />
      <Stat
        k="Raw value"
        v={money(roll.rawTotal, { cents: false })}
        n={
          roll.prices
            // The oldest price is what limits the total's freshness, so that
            // is the one worth naming.
            ? `if sold ungraded · priced ${agoLabel(roll.prices.oldest)}`
            : 'if sold ungraded'
        }
      />
      <Stat k="Grading cost" v={money(roll.costTotal, { cents: false })} n="PSA fees" />
      <Stat
        k="PSA value"
        v={money(roll.gradedTotal, { cents: false })}
        n={`if every card hits its target · ${roll.withComps} of ${roll.lines} have comps`}
      />
      <Stat
        k="Projected net"
        v={money(net, { cents: false })}
        n={
          'if every card hits its target, vs. selling raw' +
          (roll.missingComps > 0 ? ` · excludes ${roll.missingComps} without comps` : '')
        }
        tone={net > 0 ? 'good' : net < 0 ? 'bad' : null}
      />
    </div>
  )
}

function Stat({ k, v, n, tone }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={'v' + (tone ? ' ' + tone : '')}>{v}</div>
      <div className="n">{n}</div>
    </div>
  )
}
