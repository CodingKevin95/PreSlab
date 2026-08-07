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
      {/* The heading says what the number is; the caption carries the caveat
          that qualifies it. Most of this total is usually market value rather
          than money that left your pocket, so a tile headed "how much you
          spent" needs that said underneath rather than dropped. */}
      <Stat
        k="How much you spent"
        v={money(roll.spentTotal, { cents: false })}
        n={
          roll.assumedUnits > 0
            ? `${roll.assumedUnits} of ${roll.count} at market value`
            : 'what you actually paid'
        }
      />
      <Stat
        k="Raw market value"
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
        lead
      />
    </div>
  )
}

/**
 * @param lead The one figure the page exists to answer.
 *
 * Six tiles at identical weight leave nothing to look at first, so the eye has
 * to read all of them to find out which matters. This app asks whether cards
 * are worth grading; the projected net is the answer, and it should be
 * findable without reading the other five.
 */
function Stat({ k, v, n, tone, lead }) {
  return (
    <div className={'stat' + (lead ? ' stat-lead' : '')}>
      <div className="k">{k}</div>
      <div className={'v' + (tone ? ' ' + tone : '')}>{v}</div>
      <div className="n">{n}</div>
    </div>
  )
}
