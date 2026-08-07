import React, { useState, useMemo, useCallback, useRef } from 'react'
import { usePersisted, useCallBudget, uid } from './lib/storage'
import { useDiskSync } from './lib/diskSync'
import {
  DEFAULT_TIERS, STATUSES, DEFAULT_TARGET_GRADE,
  rollUp, analyzeCard, money, submissionUnits, statusOf, costsOf, isCompleted,
} from './lib/psa'
import SubmissionsPanel from './components/SubmissionsPanel'
import SubmitDialog from './components/SubmitDialog'
import { refreshPrices, getCard, searchCards, mapPool } from './api/pricetracker'
import { summariseOrder } from './lib/psaOrder'

// Identity is TCGplayer product id + printing: the same card in Holofoil and
// Reverse Holofoil are different things to own and to grade.
const keyOf = (tcgPlayerId, printing) => `${tcgPlayerId}:${printing}`


/**
 * Query used when the id lookup fails and we have to find a card by name.
 * The number matters: several cards in a set can share a name, and without it
 * the search ranks the wrong one first.
 */
const lookupQuery = (c) =>
  [c.name, c.number, c.setName].filter(Boolean).join(' ').trim()

/**
 * Folds rows describing the same printing in the same place into one.
 *
 * "The same place" includes the submission: adding a card to a batch it is
 * already in should raise that row's count, not sit beside it as a second
 * entry for the identical card. Per-copy prices are concatenated so nothing is
 * lost; other fields come from the row that was already there.
 */
function mergeSameCards(list) {
  const out = []
  const seen = new Map()
  for (const c of list) {
    const key = `${c.submissionId || ''}|${keyOf(c.tcgPlayerId, c.printing)}`
    const at = seen.get(key)
    if (at != null) {
      const costs = [...costsOf(out[at]), ...costsOf(c)]
      out[at] = {
        ...out[at],
        qty: costs.length,
        costs,
        // Keep whichever notes actually exist.
        notes: out[at].notes || c.notes || '',
      }
    } else {
      seen.set(key, out.length)
      out.push(c)
    }
  }
  return out
}
import StatsBar from './components/StatsBar'
import SearchPanel from './components/SearchPanel'
import BacklogTable from './components/BacklogTable'
import SettingsPanel from './components/SettingsPanel'
import ScreenerPanel from './components/ScreenerPanel'
import HelpPanel from './components/HelpPanel'

/**
 * Whether market scanning is offered.
 *
 * Kept to local development while its credit cost is being worked out. This
 * only hides the tab -- the relay refuses scan requests independently, since a
 * hidden button is not a control.
 */
const SCAN_ENABLED = typeof window !== 'undefined'
  && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)

const DEFAULT_SETTINGS = {
  shipmentSize: '20',
  priceBasis: 'smart',
  sellFeePct: '15',
}

const SORTS = [
  { id: 'added', label: 'Recently added' },
  { id: 'uplift', label: 'Best net gain ($)' },
  { id: 'roi', label: 'Best ROI (%)' },
  { id: 'raw', label: 'Highest raw value' },
  { id: 'name', label: 'Name' },
]

function SelectionBar({
  count, units, submissions, anyAssigned, onClear, onNew, onExisting, onRemove,
  onFetchComps, missingComps, onDelete, outOfCredits,
}) {
  const drafts = submissions.filter((s) => s.status === 'draft')
  return (
    <div className="banner info row wrap" style={{ alignItems: 'center' }}>
      <b>{count} selected</b>
      <span className="muted small">
        {units} card{units === 1 ? '' : 's'} counting duplicates
      </span>
      <div className="spacer" />
      <button
        onClick={onFetchComps}
        disabled={outOfCredits}
        title={
          outOfCredits
            ? 'No credits left today'
            : 'Re-fetch price and graded sales for just these cards, paced to stay under the per-minute limit'
        }
      >
        {missingComps > 0
          ? `Fetch comps (${count * 2} credits)`
          : `Refresh these ${count} (${count * 2} credits)`}
      </button>
      <button className="primary" onClick={onNew}>New submission</button>
      {drafts.length > 0 && (
        <select
          className="mini"
          value=""
          onChange={(e) => e.target.value && onExisting(e.target.value)}
          style={{ width: 190 }}
        >
          <option value="">Add to existing…</option>
          {drafts.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      {anyAssigned && <button onClick={onRemove}>Remove from submission</button>}
      <button className="danger" onClick={onDelete} title="Delete these rows from the backlog">
        Delete {count}
      </button>
      <button className="ghost" onClick={onClear}>Clear</button>
    </div>
  )
}

function SaveState({ disk }) {
  const map = {
    loading: ['·', 'Loading from disk…', 'var(--dimmer)'],
    ready: ['●', 'Loaded from disk', 'var(--dimmer)'],
    saving: ['●', 'Saving…', 'var(--warn)'],
    saved: ['●', 'Saved to disk', 'var(--good)'],
    error: ['▲', 'Save failed', 'var(--bad)'],
    browser: ['●', 'Saved in browser', 'var(--dimmer)'],
  }
  const [dot, label, color] = map[disk.status] || map.ready

  const title = disk.error
    ? disk.error
    : disk.status === 'browser'
      ? 'Stored in this browser. Export from Settings to keep a copy, since clearing site data will remove it.'
      : disk.path
        ? `Written to ${disk.path}. Safe from clearing browser data.`
        : 'Your backlog is written to data/backlog.json in the project folder.'

  return (
    <div className="budget" title={title} style={{ marginRight: 4 }}>
      <span style={{ color }}>{dot}</span>
      <span>{label}</span>
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState('backlog')
  const [cards, setCards] = usePersisted('cards', [])
  const [submissions, setSubmissions] = usePersisted('submissions', [])
  const [storedTiers, setTiers] = usePersisted('tiers', DEFAULT_TIERS)
  const [settings, setSettings] = usePersisted('settings', DEFAULT_SETTINGS)
  const [selected, setSelected] = useState(() => new Set())
  // Which submission the quantity dialog is currently targeting: 'new', an
  // existing submission id, or null when the dialog is closed.
  const [assignTarget, setAssignTarget] = useState(null)
  // Set when jumping from a backlog row to its submission, so that panel can
  // scroll itself into view and flag which one you came for.
  const [focusSubmission, setFocusSubmission] = useState(null)
  // The add-cards panel lives inside the backlog now. It stays collapsed so
  // one search box is obviously primary -- filtering what you own is free,
  // searching the API costs credits, and the two should not look alike.
  const [addSeed, setAddSeed] = useState('')
  // Screener results live here rather than in the panel, which unmounts when
  // you switch tabs. Losing them meant re-running a scan that had already
  // been paid for, every time you looked away.
  const [screenerCache, setScreenerCache] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)

  // Carries a term into the always-visible search box, from the empty state or
  // from a filter that matched nothing.
  const openAdd = useCallback((seed = '') => {
    setAddSeed(seed)
  }, [])

  // An empty tier list leaves the tier dropdown with nothing to choose and
  // every fee at zero, which silently makes the whole break-even calculation
  // wrong. Deriving it this way means no stored value -- from disk, from
  // localStorage, or from a bad import -- can ever produce that state.
  //
  // Bulk is stripped here too: PSA closed it, so pricing against it understates
  // every fee. Filtering rather than only changing the defaults means saved
  // configs get corrected as well, and the cleaned list is what gets written
  // back to disk.
  const tiers = useMemo(() => {
    const base = storedTiers?.length ? storedTiers : DEFAULT_TIERS
    const live = base.filter((t) => t.id !== 'bulk')
    return live.length ? live : DEFAULT_TIERS
  }, [storedTiers])

  const [statusFilter, setStatusFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('added')
  const [error, setError] = useState(null)
  const [usage, setUsage] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchingComps, setFetchingComps] = useState(null)
  const [adding, setAdding] = useState(null)
  const [notice, setNotice] = useState(null)

  // Disk is the durable copy; localStorage above is just a mirror. The ref
  // keeps the apply callback stable so the load effect runs exactly once.
  const applyRef = useRef()
  applyRef.current = (doc) => {
    if (Array.isArray(doc.cards)) setCards(doc.cards.map(withDefaults))
    if (Array.isArray(doc.submissions)) setSubmissions(doc.submissions)
    // An empty tier list is never meaningful -- it leaves the tier dropdown
    // with nothing to pick and every fee at zero. Treat it as "not configured"
    // and fall back to the defaults rather than adopting it.
    if (Array.isArray(doc.tiers) && doc.tiers.length > 0) setTiers(doc.tiers)
    if (doc.settings && Object.keys(doc.settings).length > 0) setSettings(doc.settings)
  }
  const disk = useDiskSync(
    { version: 1, cards, submissions, tiers, settings },
    applyRef,
    cards.length
  )

  const budget = useCallBudget()
  const { sync: syncBudget } = budget

  // syncBudget is stable, so this is too -- child effects depend on it.
  const handleUsage = useCallback((u) => {
    setUsage(u)
    // This API reports credits *remaining*, so derive what's been used.
    if (u?.dailyLimit != null && u?.dailyRemaining != null) {
      syncBudget(u.dailyLimit - u.dailyRemaining, u.dailyLimit)
    }
  }, [syncBudget])

  // A rate-limit rejection still carries usage headers -- worth reading, since
  // it is the response that tells us the credits are actually gone.
  const reportError = useCallback((err) => {
    if (err?.usage) handleUsage(err.usage)

    // Callers pass null to clear the banner before starting work. Coercing
    // that to a string put a literal "null" on screen after a search that had
    // actually succeeded, so treat it -- and an empty message -- as a clear.
    if (err == null) {
      setError(null)
      return
    }
    const msg = typeof err === 'string' ? err : err?.message || String(err)
    setError(msg.trim() ? msg : null)
  }, [handleUsage])

  const patchCard = useCallback((id, patch) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [setCards])

  // How many copies of this printing are already tracked, so search results can
  // show a running count instead of just "added".
  const qtyOf = useCallback(
    (tcgPlayerId, printing) => {
      const k = keyOf(tcgPlayerId, printing)
      return cards
        .filter((c) => keyOf(c.tcgPlayerId, c.printing) === k)
        .reduce((n, c) => n + Math.max(1, parseInt(c.qty, 10) || 1), 0)
    },
    [cards]
  )

  // Cards saved before qty existed load without it.
  function withDefaults(c) {
    return { ...c, qty: Math.max(1, parseInt(c.qty, 10) || 1) }
  }

  /**
   * Adds a printing to the backlog. If it's already there we just increment,
   * otherwise we spend the 2 credits to pull fresh pricing plus every graded
   * sale average, so a new card lands fully populated rather than blank.
   */
  /**
   * @param intoSubmission Add straight into this submission rather than the
   *   loose backlog.
   *
   * A card in a submission is a backlog card carrying that submission's id, so
   * nothing has to be copied or kept in step -- one row is in both places by
   * construction, and it shows up in the backlog with a Submitted status.
   */
  const addCard = useCallback(async (card, printing, intoSubmission = null) => {
    const k = keyOf(card.tcgPlayerId, printing.printing)

    // Grow the row that is already in the same place. Adding a copy to a
    // submission must not quietly change what is sitting loose in the backlog,
    // and vice versa.
    const existing = cards.find(
      (c) => keyOf(c.tcgPlayerId, c.printing) === k
        && (c.submissionId || null) === intoSubmission
    )
    if (existing) {
      patchCard(existing.id, { qty: Math.max(1, parseInt(existing.qty, 10) || 1) + 1 })
      return
    }

    setAdding(k)
    setError(null)
    try {
      const { card: full, usage } = await getCard(card.tcgPlayerId, {
        withGraded: true,
        language: card.language || 'english',
        fallbackQuery: lookupQuery(card),
      })
      if (usage) handleUsage(usage)

      const match = full.printings.find((p) => p.printing === printing.printing) || printing
      const psa = full.graded?.byCompany?.PSA || null

      setCards((prev) => [
        {
          id: uid(),
          tcgPlayerId: full.tcgPlayerId,
          pptId: full.pptId,
          language: card.language || 'english',
          name: full.name,
          setName: full.setName,
          number: full.number,
          rarity: full.rarity,
          image: full.image,
          printing: match.printing,
          condition: match.condition || 'Near Mint',
          rawPrice: match.price ?? full.marketPrice,
          priceUpdatedAt: full.lastUpdated,
          qty: 1,
          declaredValue: '',
          tierId: null,
          targetGrade: DEFAULT_TARGET_GRADE,
          submissionId: intoSubmission,
          notes: '',
          gradedPrices: psa ? Object.fromEntries(Object.entries(psa).map(([g, v]) => [g, v.price])) : {},
          gradedMeta: psa || {},
          gradedAll: full.graded?.byCompany || {},
          gradedFetchedAt: Date.now(),
          addedAt: Date.now(),
        },
        ...prev,
      ])
    } catch (err) {
      reportError(err)
    } finally {
      setAdding(null)
    }
  }, [cards, patchCard, setCards, handleUsage])

  const removeCards = useCallback((ids) => {
    const set = new Set(ids)
    setCards((prev) => prev.filter((c) => !set.has(c.id)))
    setSelected(new Set())
  }, [setCards])

  const removeCard = useCallback((id) => {
    setCards((prev) => prev.filter((c) => c.id !== id))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [setCards])

  // --- submissions --------------------------------------------------------

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  /**
   * Moves the chosen number of copies into a submission. Sending fewer copies
   * than you own splits the row: the copies going to PSA become their own row
   * inside the batch, the rest stay in the backlog. That mirrors what actually
   * happens to the physical stack.
   */
  const assignToSubmission = useCallback((submissionId, picks) => {
    setCards((prev) => {
      const out = []
      for (const c of prev) {
        const pick = picks.find((p) => p.id === c.id)
        const own = Math.max(1, parseInt(c.qty, 10) || 1)
        const send = pick ? Math.max(0, Math.min(own, pick.sendQty)) : 0

        if (send === 0) { out.push(c); continue }

        if (send >= own) {
          out.push({ ...c, submissionId })
        } else {
          // Split the per-copy prices as well as the count. Both halves used
          // to inherit the whole array and then truncate to their own quantity,
          // which duplicated the first copies' prices into both rows and threw
          // away the prices of the copies at the end.
          const cs = costsOf(c)
          out.push({ ...c, qty: own - send, costs: cs.slice(send) })
          out.push({ ...c, id: uid(), qty: send, submissionId, costs: cs.slice(0, send) })
        }
      }
      // Adding to a submission that already holds this printing merges into
      // that row rather than creating a duplicate.
      return mergeSameCards(out)
    })
    setSelected(new Set())
  }, [setCards])

  /**
   * @param picks Cards to move in. Empty creates an empty batch, which is the
   *   sensible start now that cards can be searched for from inside one.
   *
   * Named off the highest number already in use rather than the count, so
   * deleting the second of three does not make the next one a second
   * "Submission 3".
   */
  const createSubmission = useCallback((picks = []) => {
    const used = submissions
      .map((s) => /^Submission (\d+)$/.exec(s.name || '')?.[1])
      .filter(Boolean)
      .map(Number)
    const sub = {
      id: uid(),
      name: `Submission ${(used.length ? Math.max(...used) : 0) + 1}`,
      createdAt: Date.now(),
      status: 'draft',
      tracking: '',
      // Pre-filled from whatever a finished order actually returned, so the
      // scenarios start from a measured rate instead of a blank box. Still
      // editable per batch -- a submission of vintage is not the same bet as
      // one of modern.
      gemRate: settings.defaultGemRate ?? '',
    }
    setSubmissions((prev) => [sub, ...prev])
    // Skipped when empty: it would walk every card to move none of them, and
    // rewrite the whole list to the same value.
    if (picks.length) assignToSubmission(sub.id, picks)
    return sub
  }, [submissions, setSubmissions, assignToSubmission, settings.defaultGemRate])

  /**
   * Returns cards to the backlog, merging them back into an existing
   * unassigned row for the same printing so pulling a split back out doesn't
   * leave two rows of the same card sitting side by side.
   */
  const removeFromSubmission = useCallback((ids) => {
    setCards((prev) => {
      const freed = prev.map((c) =>
        ids.includes(c.id) ? { ...c, submissionId: null } : c
      )

      // Returning copies fold back into the backlog row for the same printing,
      // carrying their per-copy prices with them.
      return mergeSameCards(freed)
    })
    setSelected(new Set())
  }, [setCards])

  // No card syncing needed: a card's status is derived from which submission
  // it belongs to, so moving the submission along its own workflow cannot put
  // the two out of step.
  const patchSubmission = useCallback((id, patch) => {
    setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [setSubmissions])

  const deleteSubmission = useCallback((id) => {
    // Cards outlive their submission -- send them back to the backlog rather
    // than deleting them along with it.
    setCards((prev) =>
      prev.map((c) => (c.submissionId === id ? { ...c, submissionId: null } : c))
    )
    setSubmissions((prev) => prev.filter((s) => s.id !== id))
  }, [setCards, setSubmissions])

  // Which cards the screener should show as already owned. Keyed on TCGplayer
  // id rather than printing, so a card you hold in any printing reads as added.
  // Completed batches are finished business. They stay in the data -- their
  // cards are still submitted and still counted -- but they leave the working
  // list so it only shows what is still in play.
  /**
   * How often your cards actually hit the grade you were after, across every
   * order you have imported.
   *
   * Pooled -- total hits over total cards -- rather than averaging each order's
   * percentage. A 45-card order and a 5-card order are not equally good
   * evidence, and averaging the two rates would let the small one move your
   * planning figure as much as the large one.
   */
  const averageHitRate = useMemo(() => {
    let hits = 0
    let graded = 0
    for (const s of submissions) {
      if (!s.results) continue
      const r = summariseOrder(s.results)
      hits += r.hits
      graded += r.graded
    }
    return graded ? { rate: hits / graded, hits, graded, orders: submissions.filter((s) => s.results).length } : null
  }, [submissions])

  const activeSubs = useMemo(() => submissions.filter((s) => !isCompleted(s)), [submissions])
  const doneSubs = useMemo(() => submissions.filter(isCompleted), [submissions])

  const ownedIds = useMemo(
    () => new Set(cards.map((c) => String(c.tcgPlayerId))),
    [cards]
  )

  /**
   * Adds a screener result straight to the backlog.
   *
   * No API call: the scan already paid for this card's price and graded data,
   * so re-fetching it would charge twice for what is already in hand.
   */
  const addScanned = useCallback((s) => {
    const psa = s.graded?.byCompany?.PSA || {}
    const printing = s.printings?.[0]
    setCards((prev) => [
      {
        id: uid(),
        tcgPlayerId: String(s.tcgPlayerId),
        pptId: s.pptId,
        language: s.language || 'english',
        name: s.name,
        setName: s.setName,
        number: s.number,
        rarity: s.rarity,
        image: s.image,
        printing: printing?.printing || 'Normal',
        condition: printing?.condition || 'Near Mint',
        rawPrice: printing?.price ?? s.marketPrice,
        priceUpdatedAt: s.lastUpdated,
        qty: 1,
        declaredValue: '',
        tierId: null,
        targetGrade: DEFAULT_TARGET_GRADE,
        submissionId: null,
        notes: '',
        gradedPrices: Object.fromEntries(Object.entries(psa).map(([g, v]) => [g, v.price])),
        gradedMeta: psa,
        gradedAll: s.graded?.byCompany || {},
        gradedFetchedAt: Date.now(),
        addedAt: Date.now(),
      },
      ...prev,
    ])
  }, [setCards])

  // A card's real batch size drives which tiers it qualifies for.
  const sizeFor = useCallback(
    (card) => (card.submissionId ? submissionUnits(card.submissionId, cards) : undefined),
    [cards]
  )

  const submissionOf = useCallback(
    (card) => submissions.find((s) => s.id === card.submissionId) || null,
    [submissions]
  )

  /**
   * Fetches PSA comps for the selected cards, one API call each.
   *
   * Two credits per card and no batch endpoint, so this runs sequentially with
   * Requests run several at a time. The API client enforces the 60/min ceiling
   * centrally with a rolling window, so a batch smaller than that window runs
   * at full speed instead of being artificially spaced out.
   */
  async function fetchCompsFor(ids) {
    const targets = cards.filter((c) => ids.includes(c.id))
    if (targets.length === 0) return

    setFetchingComps({ done: 0, total: targets.length })
    setError(null)
    setNotice(null)

    let found = 0
    const failed = []
    let fatal = null

    await mapPool(
      targets,
      async (card) => {
        if (fatal) return
        try {
          const r = await getCard(card.tcgPlayerId, {
            withGraded: true,
            force: true,
            fallbackQuery: lookupQuery(card),
            language: card.language || 'english',
          })
          const psa = r.card.graded?.byCompany?.PSA || {}
          if (Object.keys(psa).length > 0) found++

          const match = r.card.printings.find((p) => p.printing === card.printing)
          patchCard(card.id, {
            rawPrice: match?.price ?? r.card.marketPrice ?? card.rawPrice,
            priceUpdatedAt: r.card.lastUpdated,
            gradedPrices: Object.fromEntries(Object.entries(psa).map(([g, v]) => [g, v.price])),
            gradedMeta: psa,
            gradedAll: r.card.graded?.byCompany || {},
            gradedFetchedAt: Date.now(),
          })
          if (r.usage) handleUsage(r.usage)
        } catch (err) {
          // Credit exhaustion dooms every remaining card; a single bad lookup
          // does not.
          if (err.status === 429) { fatal = err; return }
          failed.push(card.name)
        }
      },
      { onDone: (done, total) => setFetchingComps({ done, total }) }
    )

    setFetchingComps(null)
    setSelected(new Set())

    if (fatal) {
      if (fatal.usage) handleUsage(fatal.usage)
      setError(`${fatal.message} Anything already fetched is saved.`)
    } else {
      const ok = targets.length - failed.length
      setNotice(
        `Refreshed ${ok} card${ok === 1 ? '' : 's'}. ${found} had PSA sales on record, ${ok - found} had none.` +
        (failed.length ? ` The API returned nothing for: ${failed.join(', ')}.` : '')
      )
    }
  }

  /**
   * Re-attaches cards saved under the old provider's identifiers.
   *
   * Those cards still have their name, set, quantity and notes -- only the id
   * is meaningless here -- so they're matched by name and set rather than made
   * you re-enter them.
   *
   * One search per card with graded data attached: 2 credits, and it avoids
   * the id lookup, which intermittently returns nothing for ids that exist. A
   * card that fails is skipped and named at the end rather than aborting the
   * rest of the batch.
   */
  async function relinkLegacy() {
    const legacy = cards.filter((c) => !c.tcgPlayerId)
    if (legacy.length === 0) return

    setFetchingComps({ done: 0, total: legacy.length })
    setError(null)
    setNotice(null)

    let linked = 0
    const failed = []
    let fatal = null

    for (const [i, card] of legacy.entries()) {
      try {
        const q = lookupQuery(card)
        const r = await searchCards({ q, limit: 1, withGraded: true })
        if (r.usage) handleUsage(r.usage)

        const match = r.data?.[0]
        if (!match) {
          failed.push(card.name)
        } else {
          const psa = match.graded?.byCompany?.PSA || {}
          const printing =
            match.printings.find((p) => p.printing === card.printing) || match.printings[0]

          patchCard(card.id, {
            tcgPlayerId: match.tcgPlayerId,
            pptId: match.pptId,
            image: match.image,
            number: match.number ?? card.number,
            rarity: match.rarity ?? card.rarity,
            printing: printing?.printing || card.printing,
            condition: printing?.condition || card.condition,
            rawPrice: printing?.price ?? match.marketPrice ?? card.rawPrice,
            priceUpdatedAt: match.lastUpdated,
            gradedPrices: Object.fromEntries(Object.entries(psa).map(([g, v]) => [g, v.price])),
            gradedMeta: psa,
            gradedAll: match.graded?.byCompany || {},
            gradedFetchedAt: Date.now(),
          })
          linked++
        }
      } catch (err) {
        // Rate limiting is the one thing worth stopping for -- everything
        // after it would fail too.
        if (err.status === 429) { fatal = err; break }
        failed.push(card.name)
      }

      setFetchingComps({ done: i + 1, total: legacy.length })
    }

    setFetchingComps(null)

    if (fatal) {
      if (fatal.usage) handleUsage(fatal.usage)
      setError(`${fatal.message} Re-linked ${linked} before stopping; run it again to finish.`)
    } else {
      setNotice(
        `Re-linked ${linked} of ${legacy.length} card${legacy.length === 1 ? '' : 's'}.` +
        (failed.length ? ` No match found for: ${failed.join(', ')}. Search for those by hand and re-add them.` : '')
      )
    }
  }

  async function refreshAll() {
    const active = cards.filter((c) => c.tcgPlayerId)
    const items = active.map((c) => ({
      tcgPlayerId: c.tcgPlayerId,
      query: lookupQuery(c),
      language: c.language || 'english',
    }))
    if (items.length === 0) return

    setRefreshing(true)
    setError(null)
    setNotice(null)
    try {
      const { cards: fresh, usage: u, calls, failed } = await refreshPrices(items, {
        onProgress: (done, total) => setFetchingComps({ done, total }),
      })
      setCards((prev) =>
        prev.map((c) => {
          const f = fresh.get(c.tcgPlayerId)
          if (!f) return c
          const match = f.printings.find((p) => p.printing === c.printing)
          return {
            ...c,
            rawPrice: match?.price ?? f.marketPrice ?? c.rawPrice,
            priceUpdatedAt: f.lastUpdated,
          }
        })
      )
      if (u) handleUsage(u)

      /*
        Rows updated, not cards fetched.

        These differ whenever you hold the same card in two printings: identity
        is the TCGplayer id plus the printing, so that is two rows, but one
        lookup covers both and the price applies to each. Comparing the fetched
        count against the row count read as a failure -- "102 of 103" -- when
        every row had in fact been updated.
      */
      const updatedRows = active.filter((c) => fresh.has(c.tcgPlayerId)).length
      const spare = items.length - fresh.size

      setNotice(
        `Updated ${updatedRows} card${updatedRows === 1 ? '' : 's'} ` +
        `using ${calls} credit${calls === 1 ? '' : 's'}.` +
        (spare > 0 && !failed?.length
          ? ` ${spare} of them share a card with another row, so they cost one lookup between them.`
          : '') +
        (failed?.length ? ` The API returned nothing for: ${failed.join(', ')}.` : '')
      )
    } catch (err) {
      reportError(err)
    } finally {
      setRefreshing(false)
      setFetchingComps(null)
    }
  }

  /**
   * What the backlog is about: cards still in play.
   *
   * A card in a completed batch has been sent, graded and returned, so it is no
   * longer a decision. Leaving it here padded the list with finished business
   * and, worse, kept it in the totals -- Projected net counted profit on cards
   * whose grades are already known.
   *
   * They are filtered from the view, not removed. The completed submission is
   * still their record, and deleting that batch still returns them here.
   */
  const doneIds = useMemo(
    () => new Set(submissions.filter(isCompleted).map((s) => s.id)),
    [submissions]
  )
  const liveCards = useMemo(
    () => cards.filter((c) => !c.submissionId || !doneIds.has(c.submissionId)),
    [cards, doneIds]
  )

  const visible = useMemo(() => {
    let list = liveCards
    if (statusFilter !== 'all') list = list.filter((c) => statusOf(c) === statusFilter)

    // Every word must appear somewhere on the card, so "umbreon alt" and
    // "alt umbreon" both work and extra words narrow rather than broaden.
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length) {
      list = list.filter((c) => {
        const hay = [
          c.name, c.setName, c.number, c.rarity, c.printing, c.condition, c.notes,
          submissions.find((s) => s.id === c.submissionId)?.name,
        ].filter(Boolean).join(' ').toLowerCase()
        return terms.every((t) => hay.includes(t))
      })
    }

    const sorted = [...list]
    if (sort === 'added') sorted.sort((a, b) => b.addedAt - a.addedAt)
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'raw') sorted.sort((a, b) => (b.rawPrice || 0) - (a.rawPrice || 0))
    if (sort === 'uplift' || sort === 'roi') {
      const field = sort === 'roi' ? 'roi' : 'lineUplift'
      sorted.sort((a, b) => {
        const ua = analyzeCard(a, tiers, settings, sizeFor(a))[field]
        const ub = analyzeCard(b, tiers, settings, sizeFor(b))[field]
        // Cards with no comp sink to the bottom either way.
        if (ua == null && ub == null) return 0
        if (ua == null) return 1
        if (ub == null) return -1
        return ub - ua
      })
    }
    return sorted
  }, [cards, statusFilter, query, sort, tiers, settings, sizeFor, submissions])

  const roll = useMemo(
    () => rollUp(liveCards, tiers, settings, sizeFor),
    [liveCards, tiers, settings, sizeFor]
  )

  const legacyCount = useMemo(() => cards.filter((c) => !c.tcgPlayerId).length, [cards])

  // Once the daily credits are gone, every button that spends them will fail.
  // Disabling them up front beats letting each one error in turn.
  const outOfCredits = usage?.dailyRemaining === 0

  // The used/limit/percentage figures that lived here only ever fed the meter
  // in the top bar. Usage itself is still tracked -- outOfCredits above comes
  // from it and still disables the buttons that spend credits.

  return (
    <div className="app">
      <div className="topbar">
        {/* A real link rather than a click handler: the two pages are separate
            routes, so this has to be something you can middle-click, open in a
            new tab, or copy the address of. */}
        <a className="brand" href="/" title="Back to the PreSlab intro">
          PreSlab
        </a>
        <div className="spacer" />
        <SaveState disk={disk} />
        {/*
          The running credit meter used to sit here. It reported a number
          nobody acts on -- what costs credits is stated on the button that
          spends them, and running out produces an error that says so plainly,
          so a permanent counter was noise in the one place that should stay
          calm.

          Still tracked and still enforced; only the readout is gone.
        */}
        <div className="tabs">
          {[
            ['backlog', 'Backlog'],
            ['submissions', `Submissions${activeSubs.length ? ` (${activeSubs.length})` : ''}`],
            ['completed', `Completed${doneSubs.length ? ` (${doneSubs.length})` : ''}`],
            ...(SCAN_ENABLED ? [['find', 'Find cards']] : []),
            ['settings', 'Settings'],
          ].filter(Boolean).map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Below the banners rather than above them: those are transient and
          about something the user just did, so they keep the top spot. */}
      {error && (
        <div className="banner err">
          {error}
          <button className="ghost" style={{ float: 'right' }} onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {notice && (
        <div className="banner info">
          {notice}
          <button className="ghost" style={{ float: 'right' }} onClick={() => setNotice(null)}>✕</button>
        </div>
      )}
      {fetchingComps && (
        <div className="banner info">
          Fetching PSA comps: {fetchingComps.done} of {fetchingComps.total} done.
          <span className="muted small" style={{ marginLeft: 8 }}>
            Paced ~6s apart to stay under the 10/min limit, so this takes a moment.
          </span>
        </div>
      )}

      {tab === 'backlog' && (
        <>
          {legacyCount > 0 && (
            <div className="banner info">
              <b>{legacyCount} card{legacyCount === 1 ? '' : 's'}</b> came from the old
              pricing source and aren&apos;t linked yet, so they can&apos;t refresh or show
              graded sales. Re-linking matches them by name and keeps your quantities,
              notes and submissions.
              <button
                className="primary"
                style={{ marginLeft: 12 }}
                onClick={relinkLegacy}
                disabled={!!fetchingComps || outOfCredits}
                title={outOfCredits ? 'No credits left today' : undefined}
              >
                Re-link {legacyCount} card{legacyCount === 1 ? '' : 's'} ({legacyCount * 2} credits)
              </button>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <StatsBar roll={roll} />
          </div>

          <SearchPanel
            onAdd={addCard}
            qtyOf={qtyOf}
            adding={adding}
            onUsage={handleUsage}
            onError={reportError}
            seed={addSeed}
          />

          <div className="row wrap" style={{ marginBottom: 14 }}>
            <div style={{ position: 'relative', width: 260 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter backlog…"
                style={{ paddingRight: query ? 28 : 10 }}
              />
              {query && (
                <button
                  className="ghost"
                  onClick={() => setQuery('')}
                  title="Clear filter"
                  style={{
                    position: 'absolute', right: 2, top: '50%',
                    transform: 'translateY(-50%)', padding: '2px 6px',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ width: 190 }}
            >
              <option value="all">All cards ({cards.length})</option>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({cards.filter((c) => statusOf(c) === s.id).length})
                </option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 170 }}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            {(query || statusFilter !== 'all') && (
              <span className="small muted">
                {visible.length} of {cards.length}
              </span>
            )}
            <div className="spacer" />
            <span className="small muted">
              {cards.length > 0 &&
                `${new Set(cards.map((c) => c.tcgPlayerId).filter(Boolean)).size} credits to refresh all`}
            </span>
            <button
              onClick={refreshAll}
              disabled={refreshing || cards.length === 0 || outOfCredits}
              title={outOfCredits ? 'No credits left today' : undefined}
            >
              {refreshing ? 'Refreshing…' : 'Refresh prices'}
            </button>
          </div>

          {selected.size > 0 && (
            <SelectionBar
              count={selected.size}
              units={cards
                .filter((c) => selected.has(c.id))
                .reduce((n, c) => n + Math.max(1, parseInt(c.qty, 10) || 1), 0)}
              submissions={submissions}
              anyAssigned={cards.some((c) => selected.has(c.id) && c.submissionId)}
              onClear={() => setSelected(new Set())}
              onNew={() => setAssignTarget('new')}
              onExisting={(id) => setAssignTarget(id)}
              onRemove={() => removeFromSubmission([...selected])}
              onDelete={() => {
                const chosen = cards.filter((c) => selected.has(c.id))
                const units = chosen.reduce(
                  (n, c) => n + Math.max(1, parseInt(c.qty, 10) || 1), 0
                )
                const inSubs = chosen.filter((c) => c.submissionId).length

                const lines = [
                  `Delete ${chosen.length} row${chosen.length === 1 ? '' : 's'} (${units} card${units === 1 ? '' : 's'}) from the backlog?`,
                  '',
                  ...chosen.slice(0, 8).map((c) => `  • ${c.name}, ${c.printing} ×${Math.max(1, parseInt(c.qty, 10) || 1)}`),
                  ...(chosen.length > 8 ? [`  …and ${chosen.length - 8} more`] : []),
                ]
                if (inSubs > 0) {
                  lines.push('', `${inSubs} of these are in a submission and will be removed from it too.`)
                }
                lines.push('', 'The app cannot undo this, but data/backlog.bak.json still holds the previous save.')

                if (window.confirm(lines.join('\n'))) {
                  removeCards([...selected])
                  setNotice(`Deleted ${chosen.length} row${chosen.length === 1 ? '' : 's'} (${units} card${units === 1 ? '' : 's'}).`)
                }
              }}
              outOfCredits={outOfCredits}
              onFetchComps={() => fetchCompsFor([...selected])}
              missingComps={
                cards.filter((c) => selected.has(c.id) && !c.gradedFetchedAt).length
              }
            />
          )}

          {assignTarget && (
            <SubmitDialog
              cards={cards.filter((c) => selected.has(c.id))}
              targetName={
                assignTarget === 'new'
                  ? `Submission ${submissions.length + 1}`
                  : submissions.find((s) => s.id === assignTarget)?.name || 'submission'
              }
              onCancel={() => setAssignTarget(null)}
              onConfirm={(picks) => {
                const sending = picks.filter((p) => p.sendQty > 0)
                const units = sending.reduce((n, p) => n + p.sendQty, 0)
                if (assignTarget === 'new') {
                  const sub = createSubmission(sending)
                  setNotice(`Created ${sub.name} with ${units} card${units === 1 ? '' : 's'}.`)
                  setTab('submissions')
                } else {
                  const name = submissions.find((s) => s.id === assignTarget)?.name
                  assignToSubmission(assignTarget, sending)
                  setNotice(`Added ${units} card${units === 1 ? '' : 's'} to ${name}.`)
                }
                setAssignTarget(null)
              }}
            />
          )}

          <BacklogTable
            cards={visible}
            tiers={tiers}
            settings={settings}
            onPatch={patchCard}
            onRemove={removeCard}
            onUsage={handleUsage}
            onError={setError}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleAll={() =>
              setSelected((prev) =>
                visible.every((c) => prev.has(c.id))
                  ? new Set()
                  : new Set(visible.map((c) => c.id))
              )
            }
            submissionOf={submissionOf}
            sizeFor={sizeFor}
            filtered={Boolean(query) || statusFilter !== 'all'}
            onOpenSubmission={(id) => {
              setFocusSubmission(id)
              setTab('submissions')
            }}
            query={query}
            onAdd={openAdd}
          />
        </>
      )}

      {tab === 'submissions' && (
        <SubmissionsPanel
          submissions={activeSubs}
          cards={cards}
          tiers={tiers}
          settings={settings}
          onPatchSubmission={(id, patch) => {
            patchSubmission(id, patch)
            if (patch.status === 'completed') {
              setNotice('Marked completed. It moved to the Completed tab.')
            }
          }}
          onDeleteSubmission={deleteSubmission}
          onRemoveCards={removeFromSubmission}
          onPatchCard={patchCard}
          onGoToBacklog={() => setTab('backlog')}
          onAddCard={addCard}
          averageHitRate={averageHitRate}
          onUseRate={(pct) => {
            setSettings({ ...settings, defaultGemRate: String(pct) })
            setNotice(`New submissions will start at ${pct}%.`)
          }}
          onNewSubmission={() => {
            const sub = createSubmission()
            setNotice(`Created ${sub.name}. Search below to add cards to it.`)
            setFocusSubmission(sub.id)
          }}
          qtyOf={qtyOf}
          adding={adding}
          onUsage={handleUsage}
          onError={reportError}
          focusId={focusSubmission}
          onFocused={() => setFocusSubmission(null)}
        />
      )}

      {tab === 'completed' && (
        <SubmissionsPanel
          completed
          averageHitRate={averageHitRate}
          onUseRate={(pct) => {
            setSettings({ ...settings, defaultGemRate: String(pct) })
            setNotice(`New submissions will start at ${pct}%.`)
          }}
          onImportOrder={(results, filename) => {
            /*
              Recorded on the submission rather than added to the backlog.
              These have a cert and a real grade but no TCGplayer id, printing
              or price, so nothing in the app can be calculated from them --
              they belong here as a record of what happened.
            */
            const order = /(\d{5,})/.exec(filename || '')?.[1] || ''
            const sub = {
              id: uid(),
              name: order ? `PSA order ${order}` : 'Imported PSA order',
              createdAt: Date.now(),
              status: 'completed',
              tracking: order,
              results,
            }
            setSubmissions((prev) => [sub, ...prev])
            setNotice(`Imported ${results.length} graded card${results.length === 1 ? '' : 's'}.`)
            setFocusSubmission(sub.id)
          }}
          submissions={doneSubs}
          cards={cards}
          tiers={tiers}
          settings={settings}
          onPatchSubmission={patchSubmission}
          onDeleteSubmission={deleteSubmission}
          onRemoveCards={removeFromSubmission}
          onPatchCard={patchCard}
          onGoToBacklog={() => setTab('backlog')}
          qtyOf={qtyOf}
          adding={adding}
          onUsage={handleUsage}
          onError={reportError}
          focusId={focusSubmission}
          onFocused={() => setFocusSubmission(null)}
        />
      )}

      {tab === 'find' && SCAN_ENABLED && (
        <ScreenerPanel
          tiers={tiers}
          settings={settings}
          owned={ownedIds}
          onAdd={addScanned}
          onUsage={handleUsage}
          onError={reportError}
          onGoToSettings={() => setTab('settings')}
          cache={screenerCache}
          setCache={setScreenerCache}
        />
      )}

      <HelpPanel tab={tab} open={helpOpen} onToggle={setHelpOpen} />

      {tab === 'settings' && (
        <SettingsPanel
          tiers={tiers}
          setTiers={setTiers}
          settings={settings}
          setSettings={setSettings}
          cards={cards}
          submissions={submissions}
          onImport={(parsed) => {
            /*
              A card may only claim to be in a submission that came with the
              file. Status is derived from that id, so a reference to a batch
              that is not here leaves a row reading "Submitted" with nothing to
              open -- and no way to get it back to the backlog by hand.

              This happens with version 1 exports, which never wrote submissions
              at all, and with any file edited by hand. Rather than reject those,
              the stale reference is dropped and the card lands in the backlog,
              which is recoverable.
            */
            const incoming = Array.isArray(parsed.submissions) ? parsed.submissions : []
            const known = new Set(incoming.map((s) => s.id))
            let orphaned = 0
            const cards = parsed.cards.map((c) => {
              if (!c.submissionId || known.has(c.submissionId)) return c
              orphaned++
              return { ...c, submissionId: null }
            })

            setCards(cards)
            setSubmissions(incoming)
            if (parsed.tiers) setTiers(parsed.tiers)
            if (parsed.settings) setSettings(parsed.settings)
            setSelected(new Set())

            setNotice(
              `Imported ${cards.length} cards` +
              (incoming.length ? ` and ${incoming.length} submission${incoming.length === 1 ? '' : 's'}` : '') +
              (orphaned
                ? `. ${orphaned} card${orphaned === 1 ? '' : 's'} referenced a submission that was not in the file, ` +
                  `so ${orphaned === 1 ? 'it was' : 'they were'} returned to the backlog.`
                : '.')
            )
            setTab('backlog')
          }}
        />
      )}
    </div>
  )
}

