/**
 * Builds a local price snapshot for chosen sets.
 *
 * Run by hand, not at build time: it spends real credits, and a deploy should
 * never be able to quietly cost money. The output is committed, so the app
 * ships with prices for the sets people are most likely to be grading and pays
 * nothing to serve them.
 *
 *   node scripts/snapshot.mjs --series "Scarlet & Violet,Mega Evolutions"
 *   node scripts/snapshot.mjs --set 24655            # one set by numeric id
 *   node scripts/snapshot.mjs --series "..." --dry   # cost it without spending
 *
 * Needs POKEMONPRICETRACKER_API_KEY, read from .env.local.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import https from 'https'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT = resolve(ROOT, 'public/data/snapshot.json')
const API = 'https://www.pokemonpricetracker.com/api/v2'

function apiKey() {
  const env = resolve(ROOT, '.env.local')
  if (!existsSync(env)) throw new Error('No .env.local found.')
  const m = /POKEMONPRICETRACKER_API_KEY\s*=\s*(\S+)/.exec(readFileSync(env, 'utf8'))
  if (!m) throw new Error('POKEMONPRICETRACKER_API_KEY not set in .env.local.')
  return m[1].trim()
}

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf('--' + name)
  return i === -1 ? null : args[i + 1]
}
const DRY = args.includes('--dry')

const KEY = apiKey()
const headers = { authorization: `Bearer ${KEY}`, accept: 'application/json' }

// The API allows 60 a minute. One a second leaves room for anything else using
// the same key while this runs for several minutes.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Plain https rather than fetch: this runs on whatever Node the project is
 * pinned to, and global fetch only arrived in Node 18. A polyfill dependency
 * for one script is not worth carrying.
 */
function req(path) {
  return new Promise((resolve, reject) => {
    https.get(API + path, { headers }, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    }).on('error', reject)
  })
}

async function get(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await req(path)
    if (res.status === 429 && attempt < 5) {
      const reset = Number(res.headers['x-ratelimit-minute-reset']) * 1000
      const wait = Number.isFinite(reset) ? Math.max(1000, reset - Date.now() + 500) : 60_000
      console.log(`  rate limited, waiting ${Math.round(wait / 1000)}s`)
      await sleep(wait)
      continue
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`${res.status} on ${path}: ${res.body.slice(0, 160)}`)
    }
    return JSON.parse(res.body)
  }
}

async function allSets() {
  const out = []
  for (let offset = 0; offset < 2000; offset += 100) {
    const json = await get(`/sets?limit=100&offset=${offset}`)
    const batch = json.data || []
    out.push(...batch)
    if (batch.length < 100) break
  }
  return out
}

/**
 * Keeps only what the app reads.
 *
 * The raw payload carries price history, scrape timestamps and every grading
 * company. Storing it whole would multiply the file for data nothing displays.
 */
function slim(c) {
  const printings = Object.entries(c.variants || {}).map(([name, v]) => ({
    p: name,
    pr: v.marketPrice ?? null,
    lo: v.lowPrice ?? null,
    cond: v.conditionUsed || 'Near Mint',
  }))
  if (!printings.length && c.prices?.market != null) {
    printings.push({
      p: c.prices.primaryPrinting || 'Normal',
      pr: c.prices.market,
      lo: c.prices.low ?? null,
      cond: 'Near Mint',
    })
  }

  const psa = {}
  for (const [k, v] of Object.entries(c.ebay?.salesByGrade || {})) {
    const m = /^psa([0-9.]+)$/i.exec(k)
    if (!m || v?.averagePrice == null) continue
    psa[m[1]] = {
      price: v.averagePrice,
      median: v.medianPrice ?? null,
      count: v.count ?? 0,
      avg7d: v.marketPrice7Day ?? null,
      median7d: v.marketPriceMedian7Day ?? null,
      smart: v.smartMarketPrice?.price ?? null,
      sc: v.smartMarketPrice?.confidence ?? null,
      sd: v.smartMarketPrice?.daysUsed ?? null,
      trend: v.marketTrend || null,
      last: v.lastSaleDate || null,
    }
  }

  return {
    id: String(c.tcgPlayerId),
    n: c.name,
    s: c.setName,
    num: c.cardNumber,
    r: c.rarity,
    img: c.imageCdnUrl200 || c.imageUrl || null,
    mp: c.prices?.market ?? null,
    up: c.prices?.lastUpdated || null,
    pt: printings,
    psa,
  }
}

async function fetchSet(set) {
  const out = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const json = await get(
      `/cards?setId=${set.tcgPlayerNumericId}&limit=100&offset=${offset}&includeEbay=true`
    )
    const batch = json.data || []
    out.push(...batch.map(slim))
    process.stdout.write(`\r  ${set.name}: ${out.length}/${set.cardCount ?? '?'}   `)
    if (batch.length < 100) break
    await sleep(1100)
  }
  process.stdout.write('\n')
  return out
}

const sets = await allSets()
const wantSeries = (arg('series') || '').split(',').map((s) => s.trim()).filter(Boolean)
const wantSet = arg('set')

let chosen = sets.filter((s) => s.tcgPlayerNumericId != null)
if (wantSet) chosen = chosen.filter((s) => String(s.tcgPlayerNumericId) === String(wantSet))
else if (wantSeries.length) chosen = chosen.filter((s) => wantSeries.includes(s.series))
else { console.error('Pass --series or --set.'); process.exit(1) }

chosen.sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')))

const cardTotal = chosen.reduce((n, s) => n + (s.cardCount || 0), 0)
console.log(`${chosen.length} sets, about ${cardTotal} cards, about ${cardTotal * 2} credits\n`)
if (DRY) {
  for (const s of chosen) console.log(`  ${s.name} (${s.cardCount ?? '?'})`)
  process.exit(0)
}

const cards = []
for (const s of chosen) cards.push(...await fetchSet(s))

/*
  Merged into whatever is already there rather than replacing it.

  A full snapshot costs more than one day's allowance, so it has to be built
  across several runs. Overwriting would mean each day threw away the last, and
  a run that stopped early would lose everything it had already paid for.

  Cards are keyed by id, so re-running a set refreshes it in place.
*/
mkdirSync(dirname(OUT), { recursive: true })

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { sets: [], cards: [] }
const byId = new Map((prev.cards || []).map((c) => [c.id, c]))
for (const c of cards) byId.set(c.id, c)

const setById = new Map((prev.sets || []).map((s) => [s.id, s]))
for (const s of chosen) {
  setById.set(s.tcgPlayerNumericId, {
    id: s.tcgPlayerNumericId, name: s.name, series: s.series,
  })
}

const doc = {
  builtAt: new Date().toISOString(),
  sets: [...setById.values()].sort((a, b) => a.name.localeCompare(b.name)),
  cards: [...byId.values()],
}
writeFileSync(OUT, JSON.stringify(doc))

const added = doc.cards.length - (prev.cards || []).length
if (prev.cards?.length) {
  console.log(`
Merged with the existing snapshot: ${added} new, ${cards.length - added} refreshed`)
}

const kb = (Buffer.byteLength(JSON.stringify(doc)) / 1024).toFixed(0)
console.log(`\nWrote ${cards.length} cards to public/data/snapshot.json (${kb} KB)`)
console.log(`Per card: ${(kb / Math.max(1, cards.length)).toFixed(2)} KB`)
