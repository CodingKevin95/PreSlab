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
  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path]
  const path = '/' + segments.filter(Boolean).join('/')

  // Rebuild the query string without the catch-all route parameter.
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x))
    else params.append(k, v)
  }
  const qs = params.toString()

  // A visitor's own key takes precedence over the shared one, so bringing your
  // own key lifts you off this deployment's quota.
  const visitorKey = req.headers['x-user-api-key']
  const apiKey = visitorKey || process.env.POKEMONPRICETRACKER_API_KEY

  if (!apiKey) {
    res.status(500).json({
      error: 'No API key configured. Add POKEMONPRICETRACKER_API_KEY in the deployment settings, or paste your own key in Settings.',
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
   * Cap on how much of the shared key visitors may spend, so trying the app
   * out cannot drain the owner's daily allowance.
   *
   * Derived from the upstream's own remaining-credit header rather than a
   * counter here: serverless invocations share no memory, and a browser-side
   * tally would reset the moment someone cleared their storage. This cannot be
   * bypassed because the number comes from the API itself.
   *
   * Visitors using their own key are unaffected -- the cap exists to protect
   * the shared one.
   */
  if (!visitorKey) {
    const budget = Number(process.env.SHARED_KEY_CREDITS || 2000)
    const limit = Number(upstream.headers.get('x-ratelimit-daily-limit'))
    const remaining = Number(upstream.headers.get('x-ratelimit-daily-remaining'))

    if (Number.isFinite(limit) && Number.isFinite(remaining)) {
      const spent = limit - remaining
      if (spent >= budget) {
        res.status(429).json({
          error:
            `The shared trial allowance of ${budget} lookups is used up for today. ` +
            `Add your own free API key in Settings to keep going — you'll get your ` +
            `own daily allowance and won't share it with anyone.`,
          code: 'SHARED_BUDGET_EXHAUSTED',
        })
        return
      }
      res.setHeader('x-shared-credits-left', String(Math.max(0, budget - spent)))
    }
  }

  res.status(upstream.status)
  res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json')
  res.send(body)
}
