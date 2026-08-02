import { load, save } from '../lib/storage'

// Requests go through the Vite dev proxy, which attaches the bearer token
// server-side. The key is never present in the browser bundle.
const BASE = '/api/tcg'

// This API bills per CARD, not per request: a search returning 6 cards costs 6
// credits out of 100/day, and +1 per card again for eBay graded data. Caching
// is therefore load-bearing, not an optimisation.
const TTL = {
  search: 1000 * 60 * 60 * 6,
  card: 1000 * 60 * 60 * 6,
  graded: 1000 * 60 * 60 * 24,
  // Sets change only when a new expansion ships, and prices are not involved,
  // so this can be held far longer than anything price-derived.
  sets: 1000 * 60 * 60 * 24 * 7,
}

const SETS_KEY = 'sets:v1'

// Bumped to v2 to discard entries written before the fallback verified card
// identity: a wrong card cached under the right card's key would otherwise
// keep being served without ever touching the API again.
const CACHE_KEY = 'ppt-cache-v2'
let cache = load(CACHE_KEY, {})

function cacheGet(key, ttl) {
  const hit = cache[key]
  if (!hit || Date.now() - hit.t > ttl) return null
  return hit.v
}

function cacheSet(key, value) {
  cache[key] = { t: Date.now(), v: value }
  const keys = Object.keys(cache)
  if (keys.length > 300) {
    keys.sort((a, b) => cache[a].t - cache[b].t)
      .slice(0, keys.length - 300)
      .forEach((k) => delete cache[k])
  }
  save(CACHE_KEY, cache)
}

export function clearCache() {
  cache = {}
  save(CACHE_KEY, cache)
}

export class ApiError extends Error {
  constructor(message, { status, kind, resetAt, usage } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    // 'daily' exhaustion is not retryable today; 'minute' clears in seconds.
    this.kind = kind
    this.resetAt = resetAt
    // Carried so the caller can update the credit meter from the very
    // response that reported the limit.
    this.usage = usage
  }
}

function formatReset(unixSeconds) {
  if (!unixSeconds) return null
  const d = new Date(Number(unixSeconds) * 1000)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// --- rate limiting -------------------------------------------------------
//
// The cap is 60 requests per rolling minute. Spacing every call ~1.1s apart
// respects that but makes small batches needlessly slow: eight cards took
// nine seconds when all eight could have gone at once and still used only
// eight of the sixty.
//
// Instead: track request times in a rolling window and only wait once the
// window is genuinely full. Small batches run at full speed, large ones
// throttle themselves.
const RATE_MAX = 55 // headroom under the 60/min ceiling
const RATE_WINDOW_MS = 60_000
const RATE_KEY = 'rate-window'

// Persisted, because the server's window does not reset when the page does.
// Held only in memory, a reload mid-batch wiped the history and let the next
// burst start from zero while the API still remembered the earlier calls --
// which is exactly how you trip a limit the pacing was meant to respect.
let recentRequests = (load(RATE_KEY, []) || []).filter(
  (t) => Number.isFinite(t) && Date.now() - t < RATE_WINDOW_MS
)

async function acquireSlot() {
  for (;;) {
    const now = Date.now()
    recentRequests = recentRequests.filter((t) => now - t < RATE_WINDOW_MS)
    if (recentRequests.length < RATE_MAX) {
      recentRequests.push(now)
      save(RATE_KEY, recentRequests)
      return
    }
    await sleep(RATE_WINDOW_MS - (now - recentRequests[0]) + 50)
  }
}

/**
 * Runs `fn` over items with bounded concurrency, preserving input order.
 * `onDone` fires per completion so progress can be reported out of order.
 */
export async function mapPool(items, fn, { concurrency = 6, onDone } = {}) {
  const results = new Array(items.length)
  let next = 0
  let finished = 0

  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
      onDone?.(++finished, items.length)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  )
  return results
}

const USER_KEY = 'user-api-key'

/** A key the visitor supplied, used in place of the deployment's own. */
export function getUserKey() {
  return load(USER_KEY, '') || ''
}
export function setUserKey(key) {
  save(USER_KEY, (key || '').trim())
}

async function request(path, { retried = false } = {}) {
  await acquireSlot()

  // Sent as a header rather than a query param so it stays out of server logs
  // and browser history.
  const userKey = getUserKey()
  const headers = userKey ? { 'x-user-api-key': userKey } : undefined

  let res
  try {
    res = await fetch(BASE + path, { headers })
  } catch {
    throw new ApiError('Could not reach the API. Is the dev server running?')
  }

  let json = null
  try { json = await res.json() } catch { /* handled below */ }

  const usage = {
    dailyLimit: numOrNull(res.headers.get('x-ratelimit-daily-limit')),
    dailyRemaining: numOrNull(res.headers.get('x-ratelimit-daily-remaining')),
    minuteRemaining: numOrNull(res.headers.get('x-ratelimit-minute-remaining')),
    dailyReset: numOrNull(res.headers.get('x-ratelimit-daily-reset')),
    consumed: numOrNull(res.headers.get('x-api-calls-consumed')),
    // Set by the relay when running on the shared trial key. Absent when the
    // visitor has supplied their own.
    sharedLeft: numOrNull(res.headers.get('x-shared-credits-left')),
    keySource: res.headers.get('x-key-source') || null,
  }

  if (!res.ok) {
    // A per-minute rejection clears by itself, so wait it out once rather than
    // failing a batch the user then has to restart by hand. Daily exhaustion
    // is not retryable and falls through.
    if (res.status === 429 && usage.dailyRemaining !== 0 && !retried) {
      await sleep(RATE_WINDOW_MS / 2)
      recentRequests = []
      save(RATE_KEY, recentRequests)
      return request(path, { retried: true })
    }

    if (res.status === 429) {
      // Daily exhaustion and a per-minute burst both return 429 but need
      // opposite advice: one means come back tomorrow, the other means pause
      // for a few seconds. Telling someone to "try again" when their daily
      // quota is gone just wastes their time.
      const daily = usage.dailyRemaining === 0
      const at = formatReset(usage.dailyReset)
      throw new ApiError(
        daily
          ? `Daily credit limit reached — all ${usage.dailyLimit ?? 100} used. ` +
            `It resets at ${at || 'midnight UTC'}. Your backlog and saved prices are unaffected; ` +
            `only new lookups are paused.`
          : 'Too many requests in the last minute. Wait about 30 seconds and try again.',
        { status: 429, kind: daily ? 'daily' : 'minute', resetAt: usage.dailyReset, usage }
      )
    }
    const msg = json?.error || json?.message || `Request failed (${res.status})`
    throw new ApiError(msg, { status: res.status })
  }

  /**
   * A CDN hit never reached the API, so it spent no credits and its usage
   * headers are frozen at whatever was true when the response was first
   * stored. Reporting them would rewind the credit meter to a stale number and
   * make it look like credits came back.
   *
   * Only success responses are cacheable, so the error paths above still see
   * real usage -- a 429 is never a cache hit.
   */
  const cdnHit = (res.headers.get('x-vercel-cache') || '').toUpperCase() === 'HIT'

  return { json, usage: cdnHit ? null : usage, cdnHit }
}

function numOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Flattens one API card into the shape the app stores.
 *
 * `prices.variants` is keyed by printing then by condition, e.g.
 * { Holofoil: { "Near Mint Holofoil": { price } } }. We surface one entry per
 * printing since grading only concerns near-mint-ish copies anyway.
 */
function slimCard(c) {
  const printings = Object.entries(c.variants || {}).map(([name, v]) => ({
    printing: name,
    price: v.marketPrice ?? null,
    low: v.lowPrice ?? null,
    condition: v.conditionUsed || 'Near Mint',
  }))

  if (printings.length === 0 && c.prices?.market != null) {
    printings.push({
      printing: c.prices.primaryPrinting || 'Normal',
      price: c.prices.market,
      low: c.prices.low ?? null,
      condition: 'Near Mint',
    })
  }

  return {
    tcgPlayerId: String(c.tcgPlayerId),
    pptId: c.id,
    name: c.name,
    setName: c.setName,
    // Joins to a set's series and release date. Cards carry the set id but not
    // the series, so the era has to come from the sets endpoint.
    setId: c.setId ?? null,
    number: c.cardNumber,
    rarity: c.rarity,
    image: c.imageCdnUrl200 || c.imageUrl || null,
    marketPrice: c.prices?.market ?? null,
    lastUpdated: c.prices?.lastUpdated || null,
    printings,
    graded: c.ebay ? parseGraded(c.ebay) : null,
  }
}

/**
 * Turns `ebay.salesByGrade` into per-company grade tables.
 *
 * Keys look like "psa10", "psa9", "cgc10", "bgs9.5". Unlike the previous
 * provider, every entry carries a sale count -- a $4,000 average off 327 sales
 * is a very different claim from one off a single sale, and the UI shows that.
 */
function parseGraded(ebay) {
  const byCompany = {}
  for (const [key, v] of Object.entries(ebay.salesByGrade || {})) {
    const m = /^([a-z]+)([0-9.]+)$/i.exec(key)
    if (!m) continue
    const company = m[1].toUpperCase()
    const grade = m[2]
    if (v?.averagePrice == null) continue

    byCompany[company] ||= {}
    byCompany[company][grade] = {
      // All-time, across every recorded sale.
      price: v.averagePrice,
      median: v.medianPrice ?? null,
      min: v.minPrice ?? null,
      max: v.maxPrice ?? null,
      count: v.count ?? 0,
      // Last seven days only.
      avg7d: v.marketPrice7Day ?? null,
      median7d: v.marketPriceMedian7Day ?? null,
      volume7d: v.dailyVolume7Day ?? null,
      // The provider's own recent-window estimate: outliers filtered and
      // sales weighted, with a confidence rating and the window it actually
      // needed. Thin grades widen past 7 days to find enough sales.
      smart: v.smartMarketPrice?.price ?? null,
      smartConfidence: v.smartMarketPrice?.confidence ?? null,
      smartMethod: v.smartMarketPrice?.method ?? null,
      smartDays: v.smartMarketPrice?.daysUsed ?? null,
      trend: v.marketTrend || null,
      lastSale: v.lastSaleDate || null,
    }
  }
  return { byCompany, updatedAt: ebay.updatedAt || null }
}

/**
 * Card search. Deliberately small default limit -- every result costs a credit.
 *
 * `withGraded` adds eBay sale averages to each result for one extra credit per
 * card. Searching with it is strictly better than searching and then looking
 * the card up again: it is one credit cheaper and avoids the id lookup, which
 * intermittently returns nothing for ids that certainly exist.
 */
export async function searchCards({ q, limit = 6, withGraded = false, language = 'english' }) {
  const key = `search:${language}:${q}:${limit}:${withGraded ? 'g' : 'r'}`
  const cached = cacheGet(key, withGraded ? TTL.graded : TTL.search)
  if (cached) return { data: cached, cached: true, usage: null }

  const params = new URLSearchParams({ search: q, limit: String(limit) })
  if (withGraded) params.set('includeEbay', 'true')
  // English and Japanese are separate collections. A card in one is invisible
  // to a query against the other, including by id.
  if (language && language !== 'english') params.set('language', language)

  const { json, usage } = await request(`/cards?${params}`)
  const slim = (json.data || []).map((c) => ({ ...slimCard(c), language }))
  cacheSet(key, slim)
  return { data: slim, cached: false, usage, total: json.metadata?.total ?? slim.length }
}

/**
 * Every set, keyed by the id cards refer to, for resolving a card's era.
 *
 * Cards carry `setId` and `setName` but not the series, so "SV", "SWSH" and
 * "ME" are only readable as prefixes on a set's name -- and plenty of sets have
 * no prefix at all. The sets endpoint states the series outright.
 *
 * Charged per page rather than per set, so all 217 sets cost 3 credits, and
 * cached for a week since a set's era never changes once it has shipped.
 */
export async function getSets() {
  const cached = cacheGet(SETS_KEY, TTL.sets)
  if (cached) return { sets: cached, cached: true }

  const out = []
  for (let offset = 0; offset < 2000; offset += 100) {
    const { json } = await request(`/sets?limit=100&offset=${offset}`)
    const batch = json?.data || []
    for (const s of batch) {
      out.push({
        setId: s.tcgPlayerNumericId ?? null,
        name: s.name || '',
        series: s.series || null,
        releaseDate: s.releaseDate || null,
      })
    }
    if (batch.length < 100) break
    if (json?.metadata?.hasMore === false) break
  }

  cacheSet(SETS_KEY, out)
  return { sets: out, cached: false }
}

/**
 * Pages through a price band collecting cards with their graded sale data, for
 * ranking by grading return rather than looking up something already known.
 *
 * A price band is used because the API requires at least one filter -- there is
 * no "list everything" -- and price is the only filter that spans sets.
 *
 * Everything the ranking needs (graded prices, sales volume) lives inside the
 * ebay payload, which is charged per card. So there is no way to narrow the
 * field before paying for it: the scan fetches the pool, then filters locally.
 * That makes it the most expensive thing in the app, hence the explicit page
 * budget and the progress callback.
 *
 * Pages are 100 rather than the documented 200: asking for more still returns
 * 100 once ebay data is included.
 */
export async function scanMarket({
  minPrice = 1, maxPrice = 1000000, count = 100, language = 'english', onProgress, shouldStop,
} = {}) {
  const PAGE = 100
  const pages = Math.max(1, Math.ceil(count / PAGE))
  const out = []
  let usage = null
  let total = null

  for (let i = 0; i < pages; i++) {
    if (shouldStop?.()) break

    /*
      Always a full page, never trimmed to the remaining count.

      The CDN caches by exact URL, so a scan asking for `limit=25` would miss a
      cached `limit=100` covering the same cards and pay for them again. Fixed
      pages mean every scan size walks the same URLs, so one person's scan warms
      the cache for everyone else's -- which matters far more than the credits a
      partial last page would have saved.
    */
    const params = new URLSearchParams({
      minPrice: String(minPrice),
      maxPrice: String(maxPrice),
      limit: String(PAGE),
      offset: String(i * PAGE),
      includeEbay: 'true',
      // Most valuable first. Cards worth grading cluster at the top, and a
      // thinly-traded $2 common would fail the volume test anyway.
      sortBy: 'price',
      sortOrder: 'desc',
    })
    if (language && language !== 'english') params.set('language', language)

    const res = await request(`/cards?${params}`)
    usage = res.usage || usage
    total = res.json?.metadata?.total ?? total

    const batch = res.json?.data || []
    for (const c of batch) {
      out.push({
        ...slimCard(c),
        language,
        velocity: c.ebay?.salesVelocity || null,
        totalSales: c.ebay?.totalSales ?? 0,
        salesFrom: c.ebay?.dateRangeStart || null,
        salesTo: c.ebay?.dateRangeEnd || null,
      })
    }

    onProgress?.({ scanned: out.length, page: i + 1, pages, total, usage })

    // A short page means the band is exhausted; asking for more just burns
    // credits returning nothing.
    if (batch.length < PAGE) break
  }

  return { cards: out.slice(0, count), usage, total }
}

/**
 * One card by TCGplayer product id. With `withGraded` this is 2 credits and
 * returns raw price plus every graded sale average in a single call, which is
 * how cards get added.
 */
export async function getCard(tcgPlayerId, {
  withGraded = false, force = false, fallbackQuery = null, language = 'english',
} = {}) {
  const key = `card:${language}:${tcgPlayerId}:${withGraded ? 'g' : 'r'}`
  if (!force) {
    const cached = cacheGet(key, withGraded ? TTL.graded : TTL.card)
    // Never trust a cached card whose id doesn't match the key it was filed
    // under. Cheap insurance against a poisoned entry outliving the bug that
    // wrote it.
    if (cached && String(cached.tcgPlayerId) === String(tcgPlayerId)) {
      return { card: cached, cached: true, usage: null }
    }
  }

  const params = new URLSearchParams({ tcgPlayerId: String(tcgPlayerId) })
  if (withGraded) params.set('includeEbay', 'true')
  // Without this a Japanese card is simply not found -- the id is only valid
  // within its own language collection.
  if (language && language !== 'english') params.set('language', language)

  const { json, usage } = await request(`/cards?${params}`)
  let first = (json.data || [])[0]

  // The id lookup returns an empty set for some ids that certainly exist --
  // 246719 reproducibly, others intermittently. Search by name still finds
  // them, so fall back to it.
  //
  // The fallback MUST confirm it found the same card. Names are not unique:
  // "Rayquaza VMAX" matches both TG20 ($209) and TG29 ($34) in the same set,
  // so taking the top hit on trust silently records the wrong card at the
  // wrong price. Only an exact id match is accepted.
  if (!first && fallbackQuery) {
    const alt = await searchCards({ q: fallbackQuery, limit: 5, withGraded, language })
    const found = alt.data?.find((c) => String(c.tcgPlayerId) === String(tcgPlayerId))
    if (found) {
      cacheSet(key, found)
      return { card: found, cached: false, usage: alt.usage || usage, viaFallback: true }
    }
    throw new ApiError(
      `Could not confirm TCGplayer id ${tcgPlayerId}. The id lookup returned nothing and ` +
      `a name search matched ${alt.data?.length || 0} other card(s), none of them this one. ` +
      `Refusing to substitute a different card.`
    )
  }

  if (!first) {
    throw new ApiError(`The API returned no card for TCGplayer id ${tcgPlayerId}.`)
  }

  const slim = { ...slimCard(first), language }
  cacheSet(key, slim)
  return { card: slim, cached: false, usage }
}

/**
 * Refreshes raw prices. There is no batch endpoint here -- `tcgPlayerIds` is
 * rejected -- so this is one credit per card, paced to stay under 60/min.
 */
export async function refreshPrices(items, { onProgress } = {}) {
  // items: [{ tcgPlayerId, query }] -- query is the name-based fallback for
  // when the id lookup comes back empty.
  const seen = new Set()
  const unique = items.filter((it) => {
    if (!it?.tcgPlayerId || seen.has(it.tcgPlayerId)) return false
    seen.add(it.tcgPlayerId)
    return true
  })

  const out = new Map()
  const failed = []
  let usage = null
  let fatal = null

  await mapPool(
    unique,
    async (it) => {
      if (fatal) return
      try {
        const r = await getCard(it.tcgPlayerId, {
          withGraded: false,
          force: true,
          fallbackQuery: it.query || null,
          language: it.language || 'english',
        })
        out.set(it.tcgPlayerId, r.card)
        usage = r.usage || usage
      } catch (e) {
        // Running out of credits affects every remaining card, so stop.
        if (e.status === 429) { fatal = e; return }
        // A single card the API won't return shouldn't abort the refresh.
        failed.push(it.query || it.tcgPlayerId)
      }
    },
    { onDone: onProgress }
  )

  if (fatal) throw fatal
  return { cards: out, usage, calls: unique.length, failed }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
