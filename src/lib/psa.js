// PSA service tiers.
//
// IMPORTANT: PSA changes its price list often, and the cheap tiers open and
// close. These are editable defaults, not gospel -- verify against PSA's
// current price list and edit them in the Tiers panel. They are stored in
// localStorage once you touch them, so your edits survive reloads.
// Bulk is deliberately absent: PSA has closed it, so Value is the cheapest way
// in. Add it back here if it reopens.
export const DEFAULT_TIERS = [
  { id: 'value', name: 'Value', fee: 24.99, maxDeclared: 499, minCards: 1, note: '' },
  { id: 'value-plus', name: 'Value Plus', fee: 39.99, maxDeclared: 999, minCards: 1, note: '' },
  { id: 'regular', name: 'Regular', fee: 74.99, maxDeclared: 1499, minCards: 1, note: '' },
  { id: 'express', name: 'Express', fee: 129.99, maxDeclared: 2499, minCards: 1, note: '' },
]

/**
 * A card's status is derived from whether it belongs to a submission, never
 * set by hand. An editable field could disagree with reality -- a card marked
 * "submitted" while sitting in no submission, or the reverse -- and the whole
 * point of the submission is to be the record of what was sent.
 */
export const STATUSES = [
  { id: 'backlog', label: 'Backlog', hint: 'Not in a submission yet' },
  { id: 'submitted', label: 'Submitted', hint: 'Assigned to a submission' },
]

export function statusOf(card) {
  return card?.submissionId ? 'submitted' : 'backlog'
}

export const GRADE_OPTIONS = [10, 9.5, 9, 8.5, 8, 7, 6, 5]

// You submit hoping for a 10; anything less is the downside case.
export const DEFAULT_TARGET_GRADE = 10

// The submission's own progress. Distinct from a card's status, which is
// simply whether it is in one of these at all.
export const SUBMISSION_STATUSES = [
  { id: 'draft', label: 'Draft', hint: 'Still choosing what goes in' },
  { id: 'at-psa', label: 'At PSA', hint: 'Sent and waiting on grades' },
  { id: 'completed', label: 'Completed', hint: 'Graded and back — moves to the Completed tab' },
]

/**
 * Statuses that have been retired, and what they became.
 *
 * A stored submission keeps whatever it was last set to, so dropping an option
 * from the list above is not enough: an old value would match nothing, fall
 * back to Draft, and quietly reopen a batch that had already been sent.
 *
 * "Shipped" and "At PSA" collapsed into one -- both mean the cards are gone and
 * you are waiting -- and "Returned" is what Completed now means.
 */
const RETIRED_STATUSES = { shipped: 'at-psa', returned: 'completed' }

/** The status a submission should be treated as, old values included. */
export function statusIdOf(sub) {
  const raw = sub?.status
  const mapped = RETIRED_STATUSES[raw] || raw
  return SUBMISSION_STATUSES.some((s) => s.id === mapped) ? mapped : 'draft'
}

/** Completed batches are done with; they live on their own tab. */
export function isCompleted(sub) {
  return statusIdOf(sub) === 'completed'
}

/**
 * Closest grade we actually have a comp for. PSA 10 comps are the scarcest, so
 * a card can easily have data at 8 and 9 and nothing at the default target --
 * without this the row would read as "no data" when there is plenty.
 * Ties go to the higher grade.
 */
export function nearestGrade(gradedPrices, target) {
  const grades = Object.keys(gradedPrices || {}).map(Number).filter(Number.isFinite)
  if (grades.length === 0) return null
  return grades.sort((a, b) => {
    const d = Math.abs(a - target) - Math.abs(b - target)
    return d !== 0 ? d : b - a
  })[0]
}

export const PRICE_BASES = [
  {
    id: 'smart',
    label: 'Recent, outlier-filtered',
    hint: "The provider's own estimate: last ~7 days, extreme sales dropped, remainder weighted. Widens the window automatically when a grade is thinly traded.",
  },
  { id: 'median7d', label: 'Median, last 7 days', hint: 'Middle sale price over the last week. Ignores outliers by construction.' },
  { id: 'avg7d', label: 'Average, last 7 days', hint: 'Mean sale price over the last week. A single odd sale can move it.' },
  { id: 'median', label: 'Median, all time', hint: 'Middle price across every recorded sale. Stable, but slow to reflect a moving market.' },
  { id: 'average', label: 'Average, all time', hint: 'Mean across every recorded sale. Most affected by outliers and by old prices.' },
]

// Order each basis degrades through when the preferred figure is missing.
// Recent-window fields are null for grades with no sales in the window, which
// is common below PSA 9, so every chain has to end somewhere that always
// exists.
// `market7d` is the same 7-day average under the name used before the field
// was renamed. Cards saved then still carry real recent data, and dropping it
// would silently push them back onto all-time prices.
const BASIS_CHAIN = {
  smart: ['smart', 'median7d', 'avg7d', 'market7d', 'median', 'price'],
  median7d: ['median7d', 'smart', 'avg7d', 'market7d', 'median', 'price'],
  avg7d: ['avg7d', 'market7d', 'smart', 'median7d', 'median', 'price'],
  median: ['median', 'price'],
  average: ['price', 'median'],
}

const FIELD_LABEL = {
  smart: 'recent, filtered',
  median7d: '7-day median',
  avg7d: '7-day average',
  market7d: '7-day average',
  median: 'all-time median',
  price: 'all-time average',
}

// Fields that satisfy a basis exactly, rather than by falling back.
const BASIS_EXACT = {
  smart: ['smart'],
  median7d: ['median7d'],
  avg7d: ['avg7d', 'market7d'],
  median: ['median'],
  average: ['price'],
}

/**
 * Resolves the price to use for one grade, honouring the chosen basis and
 * reporting which figure actually got used -- a card falling back to all-time
 * data when you asked for 7-day should say so rather than look current.
 */
export function resolveGradePrice(meta, basis = 'smart') {
  if (!meta) return null
  const chain = BASIS_CHAIN[basis] || BASIS_CHAIN.smart
  for (const field of chain) {
    const v = meta[field]
    if (v != null && Number.isFinite(Number(v))) {
      return {
        price: Number(v),
        field,
        label: FIELD_LABEL[field] || field,
        exact: (BASIS_EXACT[basis] || []).includes(field),
        confidence: field === 'smart' ? meta.smartConfidence : null,
        days: field === 'smart' ? meta.smartDays : field.endsWith('7d') ? 7 : null,
      }
    }
  }
  return null
}

/**
 * Per-copy purchase prices, always exactly as long as the quantity.
 *
 * Rows saved under the older single-total field are converted by spreading
 * that total evenly, which is the best reconstruction available -- the
 * individual prices were never recorded.
 */
export function costsOf(card) {
  const qty = qtyOf(card)
  let arr = Array.isArray(card.costs) ? card.costs.slice(0, qty) : []

  if (arr.length === 0 && card.costTotal != null && card.costTotal !== '') {
    const each = Number(card.costTotal) / qty
    if (Number.isFinite(each)) arr = Array.from({ length: qty }, () => each)
  }

  while (arr.length < qty) arr.push('')
  return arr
}

/**
 * The grade a card most likely lands on when it misses the target, and what
 * that is worth. Uses the highest grade below the target that actually has a
 * comp -- usually PSA 9, but a card with only 8s on record falls to 8.
 *
 * Returns null when nothing below the target has ever sold, in which case the
 * caller has no honest floor to model with.
 */
export function fallbackGrade(card, targetGrade, basis = 'smart') {
  const meta = card?.gradedMeta || {}
  const below = Object.keys(meta)
    .map(Number)
    .filter((g) => Number.isFinite(g) && g < targetGrade)
    .sort((a, b) => b - a)

  for (const g of below) {
    const r = resolveGradePrice(meta[String(g)], basis)
    if (r) return { grade: g, price: r.price }
  }
  return null
}

/**
 * The range of outcomes at a given gem rate.
 *
 * The rate fixes *how many* cards hit the target grade, but not *which*, and
 * that choice swings the result enormously -- a batch where the cheap cards
 * gem and the expensive ones miss looks nothing like the reverse.
 *
 *   worst     the cards that hit are the ones with least to gain from hitting
 *   best      the cards that hit are the ones with most to gain
 *   expected  each card independently, weighted by the rate
 *
 * A card that misses is modelled at its fallback grade. Cards with no comp
 * below the target are counted in `noFloor` and treated as hitting in every
 * scenario, since there is no honest floor for them.
 */
export function gradeScenarios(cards, tiers, settings, submissionSize, gemRate) {
  const p = Math.max(0, Math.min(100, Number(gemRate) || 0)) / 100
  const basis = settings.priceBasis || 'smart'
  const feeRate = Math.max(0, Math.min(100, num(settings.sellFeePct ?? 15))) / 100

  // One entry per physical card, since the allocation is per copy.
  const copies = []
  let units = 0
  let noFloor = 0

  for (const card of cards) {
    const a = analyzeCard(card, tiers, settings, submissionSize)
    units += a.qty
    if (a.gradedPrice == null) continue

    const hit = a.proceeds - a.gradingCost - a.paidEach
    const fb = fallbackGrade(card, a.targetGrade, basis)
    if (!fb) noFloor += a.qty
    const miss = fb ? fb.price * (1 - feeRate) - a.gradingCost - a.paidEach : hit

    for (let i = 0; i < a.qty; i++) {
      copies.push({
        name: card.name,
        targetGrade: a.targetGrade,
        fallbackGrade: fb ? fb.grade : a.targetGrade,
        hit, miss, gain: hit - miss,
      })
    }
  }

  const priced = copies.length
  const hits = Math.round(p * priced)

  // Sorted by how much each copy gains from hitting, so the two extremes are
  // just the two ends of the same list.
  const ranked = [...copies].sort((x, y) => x.gain - y.gain)

  const worst = ranked.reduce((s, c, i) => s + (i < hits ? c.hit : c.miss), 0)
  const best = ranked.reduce((s, c, i) => s + (i >= priced - hits ? c.hit : c.miss), 0)
  const expected = copies.reduce((s, c) => s + p * c.hit + (1 - p) * c.miss, 0)

  // Which cards carry the swing, for explaining the two extremes.
  const missesInWorst = ranked.slice(hits).map((c) => c.name)
  const missesInBest = ranked.slice(0, priced - hits).map((c) => c.name)

  // Per-card breakdown of each scenario. Copies of one card can land on
  // different sides of the same allocation, so grouping is by card *and*
  // outcome -- "two hit, two missed" is a real and common result.
  const group = (entries) => {
    const map = new Map()
    for (const e of entries) {
      const key = `${e.name}|${e.grade}|${e.blend ? JSON.stringify(e.blend) : ''}`
      const at = map.get(key)
      if (at) { at.qty++; at.value += e.value } else { map.set(key, { ...e, qty: 1 }) }
    }
    return [...map.values()].sort((a, b) => b.value - a.value)
  }

  const allocate = (isHit) =>
    group(ranked.map((c, i) => {
      const hit = isHit(i)
      return {
        name: c.name,
        grade: hit ? c.targetGrade : c.fallbackGrade,
        hit,
        value: hit ? c.hit : c.miss,
      }
    }))

  return {
    best, expected, worst,
    units, priced, noFloor, hits,
    missesInWorst: [...new Set(missesInWorst)],
    missesInBest: [...new Set(missesInBest)],
    rows: {
      worst: allocate((i) => i < hits),
      best: allocate((i) => i >= priced - hits),
      // Expected has no single grade -- each copy is a weighted blend of
      // hitting and missing -- so it carries both grades and the weighting
      // instead of a bare number with no provenance.
      expected: group(copies.map((c) => ({
        name: c.name,
        grade: null,
        hit: null,
        blend: c.fallbackGrade === c.targetGrade
          ? { single: c.targetGrade }
          : { target: c.targetGrade, fallback: c.fallbackGrade, p },
        value: p * c.hit + (1 - p) * c.miss,
      }))),
    },
  }
}

/**
 * How current the raw prices are. Reports the oldest, since a total is only
 * as fresh as its stalest component.
 */
export function priceAsOf(cards) {
  const times = cards
    .map((c) => (c.priceUpdatedAt ? Date.parse(c.priceUpdatedAt) : NaN))
    .filter((t) => Number.isFinite(t))
  if (times.length === 0) return null
  return { oldest: Math.min(...times), newest: Math.max(...times), counted: times.length }
}

export function agoLabel(ts, now = Date.now()) {
  if (!ts) return null
  const days = Math.floor((now - ts) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? 'a month ago' : `${months} months ago`
}

export function qtyOf(card) {
  return Math.max(1, parseInt(card?.qty, 10) || 1)
}

/** Total number of physical cards in a submission, counting duplicates. */
export function submissionUnits(submissionId, cards) {
  return cards
    .filter((c) => c.submissionId === submissionId)
    .reduce((n, c) => n + qtyOf(c), 0)
}

/**
 * Cheapest tier a card can actually use.
 *
 * Two things gate it: the declared-value ceiling, and the tier's card minimum.
 * Bulk is the cheapest tier but typically demands 20+ cards in one submission,
 * so quoting its fee on a 6-card submission would understate every cost in the
 * app. `submissionSize` is how many cards you're actually sending.
 *
 * Returns null when the value exceeds every configured tier.
 */
export function tierForDeclaredValue(declaredValue, tiers, submissionSize = Infinity) {
  const v = Number(declaredValue) || 0
  const size = Number(submissionSize)
  const n = Number.isFinite(size) ? size : Infinity

  const eligible = tiers
    .filter((t) => v <= Number(t.maxDeclared) && n >= (Number(t.minCards) || 1))
    .sort((a, b) => Number(a.fee) - Number(b.fee))
  return eligible[0] || null
}

export function tierById(id, tiers) {
  return tiers.find((t) => t.id === id) || null
}

/**
 * Grading economics for one card.
 *
 * The comparison that matters is: what the card is worth raw today, versus
 * what it is worth graded minus what grading costs.
 */
/**
 * @param submissionSize Cards in the batch this card actually ships in. When a
 *   card is assigned to a submission this is that submission's real count, so
 *   tier eligibility stops being a guess. Falls back to the planning default
 *   in settings for cards still sitting in the backlog.
 */
export function analyzeCard(card, tiers, settings, submissionSize) {
  // Quantity multiplies everything except the tier decision -- PSA declares
  // value per card, so a stack of five $40 cards is still five Value-tier
  // slots, not one $200 slot.
  const qty = qtyOf(card)
  const raw = num(card.rawPrice)
  const targetGrade = card.targetGrade ?? DEFAULT_TARGET_GRADE

  // The graded price has to be resolved before the tier, because it is what
  // the declared value is based on.
  //
  // Prefer the full metadata so the price basis setting applies. Cards saved
  // before that existed only have the flat gradedPrices map.
  const meta = card.gradedMeta?.[String(targetGrade)]
  const resolved = resolveGradePrice(meta, settings.priceBasis || 'smart')
  const gradedPrice = resolved
    ? resolved.price
    : card.gradedPrices?.[String(targetGrade)] ?? null

  /**
   * Declared value is what the card is worth in the grade you expect, not what
   * it is worth raw. Declaring at the raw price would be internally
   * inconsistent -- banking the graded upside on the revenue side while paying
   * the cheaper tier on the cost side -- and it under-insures the card.
   * Falls back to raw only when there is no graded comp to go on.
   */
  const declared = card.declaredValue != null && card.declaredValue !== ''
    ? num(card.declaredValue)
    : (gradedPrice ?? raw)

  const batchSize = Number(submissionSize) > 0
    ? Number(submissionSize)
    : Math.max(1, num(settings.shipmentSize) || 1)

  // A pinned tier that no longer exists -- Bulk, or one deleted in Settings --
  // falls back to auto rather than leaving the card with no tier at all.
  const pinned = card.tierId ? tierById(card.tierId, tiers) : null
  const tier = pinned || tierForDeclaredValue(declared, tiers, batchSize)

  // No configured tier covers this declared value. Treating the fee as zero
  // would make an expensive card look free to grade, so flag it instead.
  const tierMissing = !tier
  const fee = tier ? num(tier.fee) : 0
  const gradingCost = fee

  let uplift = null
  let multiple = null
  let breakEven = null
  // Return on what the card actually ties up: its raw value (money you could
  // have by selling today) plus the fees to grade it. A $160 gain means very
  // different things on a $70 outlay and a $2,500 one.
  let roi = null

  // What a sale actually nets after the marketplace takes its cut. eBay is
  // around 13%, vendors vary, so the rate is a setting rather than a constant.
  const feeRate = Math.max(0, Math.min(100, num(settings.sellFeePct ?? 15))) / 100
  let proceeds = null
  let upliftNet = null
  let roiNet = null
  let upliftVsPaid = null
  let roiVsPaid = null

  // One price per copy, so buying the same card repeatedly at different prices
  // is representable exactly rather than as an average.
  //
  // A copy you haven't priced is assumed to have cost today's raw market
  // value. That keeps a profit figure available from the moment a card is
  // added, and it is the least-wrong assumption: it treats an unpriced copy as
  // though you bought it at market. The counts below let the UI say which
  // copies are real and which are assumed.
  const costs = costsOf(card)
  const entered = costs.map((v) =>
    v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null
  )
  const effective = entered.map((v) => (v == null ? raw : v))

  const paidTotal = effective.reduce((s, v) => s + v, 0)
  const enteredCount = entered.filter((v) => v != null).length
  const assumedCount = qty - enteredCount
  const hasCost = enteredCount > 0
  const fullyCosted = qty > 0
  const paidEach = qty > 0 ? paidTotal / qty : 0

  if (gradedPrice != null) {
    uplift = gradedPrice - gradingCost - raw
    multiple = raw > 0 ? gradedPrice / raw : null
    const outlay = raw + gradingCost
    roi = outlay > 0 ? uplift / outlay : null

    proceeds = gradedPrice * (1 - feeRate)
    upliftNet = proceeds - gradingCost - raw
    roiNet = outlay > 0 ? upliftNet / outlay : null

    // The same two figures measured against what the card actually cost you
    // rather than today's market value. Once a card is committed to a
    // submission the decision is made, so the useful question stops being
    // "grade or sell raw" and becomes "did this make money".
    const spentOutlay = paidEach + gradingCost
    upliftVsPaid = gradedPrice - gradingCost - paidEach
    roiVsPaid = spentOutlay > 0 ? upliftVsPaid / spentOutlay : null
  }
  // What the graded card must fetch just to cover the raw value + cost.
  breakEven = raw + gradingCost

  return {
    qty,
    raw,
    declared,
    tier,
    tierMissing,
    fee,
    gradingCost,
    targetGrade,
    gradedPrice,
    priceSource: resolved || null,
    gradeMeta: meta || null,
    uplift,
    multiple,
    roi,
    feeRate,
    proceeds,
    upliftNet,
    roiNet,
    upliftVsPaid,
    roiVsPaid,
    breakEven,
    // With no tier the fee is unknown, so the net figure is optimistic by an
    // unknown amount -- don't render it as a confident win.
    verdict: tierMissing ? 'unknown' : verdictFor(uplift, gradedPrice),
    // Line totals -- what this row is actually worth across every copy.
    lineRaw: raw * qty,
    lineCost: gradingCost * qty,
    lineGraded: gradedPrice != null ? gradedPrice * qty : null,
    lineUplift: uplift != null ? uplift * qty : null,
    lineProceeds: proceeds != null ? proceeds * qty : null,
    lineUpliftNet: upliftNet != null ? upliftNet * qty : null,

    // Cost basis. Distinct from everything above, which measures grading
    // against today's raw market value. This measures it against real money
    // spent, and is what tells you whether the position actually made money.
    costs,
    hasCost,
    enteredCount,
    assumedCount,
    fullyCosted,
    paidTotal,
    paidEach,
    // Profit is only stated once every copy has a price. Extrapolating from a
    // partly-costed row would invent a number and present it as fact.
    lineCostBasis: fullyCosted ? paidTotal + gradingCost * qty : null,
    lineProfit: fullyCosted && proceeds != null
      ? proceeds * qty - gradingCost * qty - paidTotal
      : null,
    profitRoi: fullyCosted && proceeds != null && paidTotal + gradingCost * qty > 0
      ? (proceeds * qty - gradingCost * qty - paidTotal) / (paidTotal + gradingCost * qty)
      : null,
  }
}

/**
 * Weekly sale rate, both ways the data supports measuring it.
 *
 * `recent` is the provider's own last-30-days figure. `overWindow` is the rate
 * across the whole tracked period. They diverge a lot -- a card that sold
 * steadily for months and has since gone quiet reads high on one and near zero
 * on the other -- so both are kept and shown rather than blended into a single
 * number that hides which situation you are looking at.
 */
export function weeklySales(scanned) {
  const recent = scanned?.velocity?.weeklyAverage ?? null

  let overWindow = null
  const weeks = trackedWeeks(scanned)
  if (weeks && scanned.totalSales != null) overWindow = scanned.totalSales / weeks

  return { recent, overWindow }
}

function trackedWeeks(scanned) {
  const from = scanned?.salesFrom ? Date.parse(scanned.salesFrom) : null
  const to = scanned?.salesTo ? Date.parse(scanned.salesTo) : null
  if (!from || !to || to <= from) return null
  return Math.max((to - from) / (7 * 24 * 3600 * 1000), 1)
}

/**
 * How often one specific grade actually trades, per week.
 *
 * This is the number that says whether a graded price can be trusted, and it
 * is not the same as the card's overall sales rate: a card can sell constantly
 * as a raw single while its PSA 10 has changed hands three times all year. It
 * is the PSA 10 market being thin, not the card, that makes a PSA 10 price
 * meaningless -- so the liquidity test has to be per grade.
 */
export function gradeSalesPerWeek(scanned, meta) {
  const weeks = trackedWeeks(scanned)
  if (!weeks || meta?.count == null) return null
  return meta.count / weeks
}

/**
 * Ranks scanned cards by return on grading.
 *
 * Two guards matter more than the ranking itself, because sorting by return
 * puts the worst data at the top by construction -- a nonsense graded price is
 * indistinguishable from a great opportunity once it is a single number:
 *
 *   - a grade with almost no sales is an average of noise, so `minSales` sets
 *     a floor on how many sales the graded price rests on;
 *   - a graded price far above that grade's own median is nearly always a
 *     mis-scraped lot or bundle sale, so those are flagged rather than trusted.
 *     One card in the sample showed a $2,006 "PSA 10" against a $294 median.
 */
export function screenMarket(scanned, tiers, settings, {
  minWeekly = 0, minSales = 3, targetGrade = 10, limit = 25, outlierMultiple = 3,
  maxRawMultiple = 20,
} = {}) {
  const rows = []

  for (const s of scanned) {
    const psa = s.graded?.byCompany?.PSA
    const meta = psa?.[String(targetGrade)]
    if (!meta) continue

    const raw = s.marketPrice ?? s.printings?.[0]?.price ?? null
    if (!raw || raw <= 0) continue

    // Filtered on how often this grade trades, not how often the card does.
    // A thin PSA 10 market is what makes a PSA 10 price unreliable.
    const gradeRate = gradeSalesPerWeek(s, meta)
    if ((gradeRate ?? 0) < minWeekly) continue
    if ((meta.count ?? 0) < minSales) continue

    const volume = weeklySales(s)

    const card = {
      qty: 1,
      rawPrice: raw,
      targetGrade,
      gradedPrices: Object.fromEntries(Object.entries(psa).map(([g, v]) => [g, v.price])),
      gradedMeta: psa,
    }
    const a = analyzeCard(card, tiers, settings, Math.max(1, num(settings.shipmentSize) || 1))
    if (a.gradedPrice == null || a.roiNet == null) continue

    /*
      Flagged, not dropped: sometimes the outlier is real, and silently
      discarding cards would make the list look thinner than the data is.

      The multiple check catches a class the median check cannot. A card whose
      raw price is $450 while its PSA 10 sits at $38,000 has an internally
      consistent graded price -- median and average agree -- so nothing looks
      wrong grade-side. What is wrong is the raw price: at a 90x multiple it is
      not describing a copy anyone could buy and grade. Ranking by return puts
      exactly these at the top, so they need saying out loud.
    */
    const reasons = []
    if (meta.median != null && a.gradedPrice > meta.median * outlierMultiple) {
      reasons.push(
        `The PSA 10 price of ${money(a.gradedPrice)} is more than ${outlierMultiple}x this ` +
        `grade's median of ${money(meta.median)}, which usually means a lot or bundle sale ` +
        `was scraped as a single card.`
      )
    }
    if (a.multiple != null && a.multiple > maxRawMultiple) {
      reasons.push(
        `Graded is ${Math.round(a.multiple)}x the raw price. A multiple that large usually ` +
        `means the raw price is not for a gradeable copy -- a damaged listing, a different ` +
        `printing, or a stale quote -- rather than a real opportunity.`
      )
    }

    /*
      Kept separate from `suspect` deliberately.

      A card above the highest configured tier has no fee to charge, so it is
      costed as though grading were free and its return comes out too high.
      That is a gap in the tier table rather than bad market data, and it is
      fixable in Settings -- so it is surfaced as its own thing rather than
      hidden alongside implausible prices. Hiding it would also empty the list,
      since scanning most-valuable-first finds these cards first.
    */
    rows.push({
      scanned: s, analysis: a, volume, gradeRate, meta,
      noTier: a.tierMissing,
      suspect: reasons.length > 0,
      reasons,
    })
  }

  rows.sort((x, y) => y.analysis.roiNet - x.analysis.roiNet)
  return { rows: rows.slice(0, limit), matched: rows.length }
}

function verdictFor(uplift, gradedPrice) {
  if (gradedPrice == null) return 'unknown'
  if (uplift == null) return 'unknown'
  if (uplift >= 50) return 'strong'
  if (uplift > 0) return 'marginal'
  return 'negative'
}

export function rollUp(cards, tiers, settings, sizeFor) {
  const active = cards
  let rawTotal = 0
  let costTotal = 0
  let gradedTotal = 0
  let upliftTotal = 0
  let units = 0
  let unitsWithComps = 0
  let linesWithComps = 0
  let spentTotal = 0
  let linesWithCost = 0
  let assumedUnits = 0

  for (const c of active) {
    const a = analyzeCard(c, tiers, settings, sizeFor ? sizeFor(c) : undefined)
    units += a.qty
    // Always counted. Copies without a recorded price are already valued at
    // raw market inside analyzeCard, so skipping those rows would understate
    // the total rather than leave it unknown.
    spentTotal += a.paidTotal
    assumedUnits += a.assumedCount
    if (a.hasCost) linesWithCost++
    rawTotal += a.lineRaw
    costTotal += a.lineCost
    if (a.gradedPrice != null) {
      gradedTotal += a.lineGraded
      upliftTotal += a.lineUplift
      unitsWithComps += a.qty
      linesWithComps++
    }
  }

  return {
    lines: active.length,
    count: units,
    rawTotal,
    costTotal,
    gradedTotal,
    upliftTotal,
    withComps: linesWithComps,
    unitsWithComps,
    missingComps: active.length - linesWithComps,
    spentTotal,
    linesWithCost,
    linesWithoutCost: active.length - linesWithCost,
    assumedUnits,
    prices: priceAsOf(active),
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function percent(n, opts = {}) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n) * 100
  const digits = Math.abs(v) >= 100 ? 0 : opts.digits ?? 0
  return (v > 0 ? '+' : '') + v.toFixed(digits) + '%'
}

export function money(n, opts = {}) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  })
}
