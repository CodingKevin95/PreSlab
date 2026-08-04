/**
 * Serverless equivalent of the dev-server proxy in vite.config.js.
 *
 * Exists because the upstream API rejects CORS preflights: it answers OPTIONS
 * with 401 before its CORS handler runs, and browsers require a 2xx preflight.
 * So the browser cannot call it directly even with a valid key, and every
 * request has to be relayed.
 *
 * The key is read from the environment and never sent to the client. A key
 * supplied by the visitor is forwarded but never logged or stored -- see the
 * header handling below.
 */
const UPSTREAM = 'https://www.pokemonpricetracker.com/api/v2'

// Usage headers the browser reads back to keep its credit meter honest.
const PASS_THROUGH = [
  'x-ratelimit-daily-limit',
  'x-ratelimit-daily-remaining',
  'x-ratelimit-daily-reset',
  'x-ratelimit-minute-remaining',
  'x-api-calls-consumed',
  'x-api-calls-breakdown',
]

export default async function handler(req, res) {
  /**
   * Taken from req.url rather than the catch-all route parameter.
   *
   * Reading req.query.path depends on how the runtime populates dynamic
   * segments, and when that came back empty the forwarded URL collapsed to the
   * API root and the upstream answered "Not found". The raw URL is
   * unambiguous, and passing the query string through verbatim also avoids
   * re-encoding differences.
   */
  const rawUrl = req.url || ''
  const qIndex = rawUrl.indexOf('?')
  const rawPath = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex)

  const path = rawPath.replace(/^\/api\/tcg/, '') || '/'

  /**
   * The routing layer appends the catch-all segment to the query string as
   * "...path=cards". The upstream rejects any parameter it doesn't recognise,
   * so forwarding it verbatim fails the whole request -- drop it here.
   *
   * Filtered as raw pairs rather than through URLSearchParams so values keep
   * their original encoding and are passed on byte for byte.
   */
  const qs = (qIndex === -1 ? '' : rawUrl.slice(qIndex + 1))
    .split('&')
    .filter((pair) => {
      if (!pair) return false
      const key = decodeURIComponent(pair.split('=')[0])
      return !/^\.*path$/.test(key)
    })
    .join('&')

  /**
   * Market scanning is off on the deployed site.
   *
   * It is by far the most expensive thing the app does -- hundreds of cards at
   * two credits each, against a shared daily allowance -- so it stays local
   * until that cost is worked out.
   *
   * Enforced here rather than only by hiding the tab, because a hidden button
   * does not stop anyone calling the endpoint directly, and the whole point is
   * to protect the key rather than tidy the UI. The dev server has its own
   * relay and is unaffected.
   *
   * Recognised by the filters only a scan uses: single-card lookups go by
   * tcgPlayerId and searches by search, neither of which is matched here.
   * Set ENABLE_MARKET_SCAN=true in the deployment to turn it back on.
   */
  if (/[?&](setId|minPrice)=/.test(rawUrl) && process.env.ENABLE_MARKET_SCAN !== 'true') {
    res.setHeader('cache-control', 'no-store')
    res.status(403).json({
      error:
        'Market scanning is turned off on this deployment. Everything else — ' +
        'search, adding cards, refreshing prices — works normally.',
      code: 'SCAN_DISABLED',
    })
    return
  }

  // A visitor's own key takes precedence over the shared one, so bringing your
  // own key lifts you off this deployment's quota.
  const visitorKey = req.headers['x-user-api-key']
  const apiKey = visitorKey || process.env.POKEMONPRICETRACKER_API_KEY

  if (!apiKey) {
    // Names only, never values -- enough to spot a typo or a variable scoped
    // to the wrong environment without leaking anything.
    const visible = Object.keys(process.env)
      .filter((k) => /poke|price|tracker|api.?key/i.test(k))
      .sort()

    res.status(500).json({
      error:
        'No API key configured. Add POKEMONPRICETRACKER_API_KEY in the deployment ' +
        'settings and redeploy, or paste your own key in Settings.',
      code: 'NO_API_KEY',
      diagnostic: {
        expected: 'POKEMONPRICETRACKER_API_KEY',
        similarVarsFound: visible.length ? visible : '(none)',
        totalEnvVars: Object.keys(process.env).length,
        hint: visible.length
          ? 'A similar name exists — check it matches exactly.'
          : 'Nothing similar is set. Either it was never saved, it is scoped to a different environment, or the deployment predates it — redeploy after adding.',
      },
    })
    return
  }

  let upstream
  try {
    upstream = await fetch(`${UPSTREAM}${path}${qs ? '?' + qs : ''}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    })
  } catch (err) {
    res.status(502).json({ error: `Upstream request failed: ${err.message}` })
    return
  }

  for (const h of PASS_THROUGH) {
    const v = upstream.headers.get(h)
    if (v) res.setHeader(h, v)
  }
  // Tell the browser whether its own key was used, so the UI can say so.
  res.setHeader('x-key-source', visitorKey ? 'user' : 'shared')

  const body = await upstream.text()

  /**
   * Reserve the owner keeps for themselves. Visitors are served while the key
   * still holds more than this, and cut off below it.
   *
   * Expressed as a floor rather than an allowance because there is nowhere to
   * count visitors: serverless invocations share no memory, and a browser-side
   * tally resets the moment someone clears their storage. The only number
   * available is the key's own remaining credits, which counts every use of
   * that key -- including the owner's, from anywhere.
   *
   * Spending against an allowance therefore read the owner's own usage as
   * visitor usage: a local scan of a few thousand cards exhausted a 2,000
   * "visitor" budget without a single visitor. A floor cannot make that
   * mistake, because it asks what is left rather than who spent it.
   *
   * Visitors using their own key are unaffected -- this protects the shared one.
   */
  if (!visitorKey) {
    const reserve = Number(process.env.SHARED_KEY_RESERVE || 12000)
    const limit = Number(upstream.headers.get('x-ratelimit-daily-limit'))
    const remaining = Number(upstream.headers.get('x-ratelimit-daily-remaining'))

    if (Number.isFinite(remaining)) {
      if (remaining <= reserve) {
        res.status(429).json({
          error:
            `This deployment's shared key is reserved for the owner for the rest of ` +
            `today. Add your own free API key in Settings to keep going — you'll get ` +
            `your own daily allowance and won't share it with anyone.`,
          code: 'SHARED_BUDGET_EXHAUSTED',
        })
        return
      }
      res.setHeader('x-shared-credits-left', String(Math.max(0, remaining - reserve)))
      // The pool the meter fills against. Sent rather than assumed, so changing
      // the reserve does not leave the bar quietly misreporting.
      if (Number.isFinite(limit)) {
        res.setHeader('x-shared-credits-pool', String(Math.max(1, limit - reserve)))
      }
    }
  }

  /**
   * Cached at the CDN so identical lookups are answered without calling
   * upstream at all -- and therefore without spending credits.
   *
   * This is what makes the deployment shareable. Card prices are public and
   * identical for everyone, so the per-visitor browser cache was re-buying the
   * same data for each person: ten testers looking up the same card cost ten
   * times what one did. Cached here instead, the first request pays and the
   * rest are free, including for visitors using their own key.
   *
   * Six hours matches the client-side cache, so both layers age out together
   * rather than one serving data the other considers stale.
   *
   * Errors are never cached: a rate-limit or an outage would otherwise be
   * pinned in front of a working API for hours.
   */
  if (upstream.ok) {
    /*
      Scans are held far longer than single lookups.

      A scan is the expensive thing here -- hundreds of cards at two credits
      each -- and what it reads is a graded sale average over a window of
      months, which barely moves between one day and the next. Six hours meant
      re-buying an entire scan four times a day for a number that had not
      meaningfully changed.

      Single-card lookups keep the shorter window, since those are read one at
      a time against a decision to actually buy or send something.
    */
    const isScan = /[?&](setId|minPrice)=/.test(rawUrl)
    const maxAge = isScan ? 86400 : 21600
    res.setHeader(
      'cache-control',
      `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`
    )
  } else {
    res.setHeader('cache-control', 'no-store')
  }

  res.status(upstream.status)
  res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json')
  res.send(body)
}
