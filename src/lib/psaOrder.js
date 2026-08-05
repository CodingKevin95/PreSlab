/**
 * Reads the CSV PSA gives you for a finished order.
 *
 * The columns are Cert #, Type, Description, Grade, After Service, Images. What
 * the app cares about is the cert, what the card is, and what it actually
 * graded -- the rest is kept as it came so nothing is silently dropped.
 *
 * This is a record of what happened, not inventory. Imported cards are held on
 * the submission itself rather than added to the backlog: they have no
 * TCGplayer id, no printing and no price, and mixing them in would fill the
 * backlog with rows nothing can be calculated from.
 */

/**
 * Splits CSV text into rows of fields.
 *
 * Written out rather than split on commas because descriptions contain them --
 * "LILLIE'S CLEFAIRY EX" is fine but a set name with a comma would tear a row
 * apart. Handles quoted fields, doubled quotes inside them, CRLF, and the
 * byte-order mark Excel leaves at the front.
 */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += ch
      continue
    }

    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { row.push(field); field = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }

  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

/**
 * The numeric grade out of PSA's wording.
 *
 * The label carries the number already -- "GEM MINT 10", "VERY GOOD-EXCELLENT
 * 4" -- so the trailing figure is taken rather than mapping every phrase, which
 * would break the moment PSA words one differently. Half grades are kept.
 */
export function parseGrade(label) {
  const m = /(\d+(?:\.\d+)?)\s*$/.exec(String(label || '').trim())
  return m ? Number(m[1]) : null
}

/**
 * Pulls a readable card out of PSA's description line.
 *
 * They read as: year, set, card number, name, then usually a rarity. For
 * example
 *
 *   2026 POKEMON ASC EN-ASCENDED HEROES 280 LILLIE'S CLEFAIRY EX SPECIAL
 *   ILLUSTRATION RARE
 *
 * The number is the pivot: everything before it is the year and set, everything
 * after is the card. That holds across every row in the orders seen so far, but
 * it is a convention rather than a documented format, so anything that does not
 * fit keeps the original text as its name instead of being mangled into one.
 */
export function parseDescription(desc) {
  const raw = String(desc || '').trim().replace(/\s+/g, ' ')
  const out = { raw, year: null, set: '', number: '', name: raw }

  const year = /^(\d{4})\s+(.*)$/.exec(raw)
  let rest = raw
  if (year) { out.year = Number(year[1]); rest = year[2] }

  const tokens = rest.split(' ')

  /*
    Card numbers take several shapes -- 280, 037, GG30, TG20 -- so the pivot is
    found by scanning rather than by one pattern.

    Two rules earn their keep on real orders. The number is never the last
    token, because a name always follows it, which stops "SERIES 1" being read
    as card 1. And a bare single digit is only accepted if nothing better
    exists, because set names carry them: "C-GEM PACK VOL 3 07 MEOWTH" has both
    a volume and a card number, and the card number is the second one.
  */
  const looksLikeNumber = (t) => /^[A-Z]{0,4}\d{1,4}[A-Z]?$/i.test(t)
  let best = -1
  let fallback = -1
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!looksLikeNumber(tokens[i])) continue
    const strong = /[A-Z]/i.test(tokens[i]) || /\d{2,}/.test(tokens[i])
    if (strong) best = i
    else fallback = i
  }
  const at = best !== -1 ? best : fallback
  if (at === -1) return out

  out.set = tokens.slice(0, at).join(' ')
  out.number = tokens[at]
  out.name = tokens.slice(at + 1).join(' ') || raw
  return out
}

/**
 * @returns {{ cards: object[], skipped: number, order: string|null }}
 */
export function parsePsaOrderCsv(text) {
  const rows = parseCsv(text)
  if (!rows.length) return { cards: [], skipped: 0, order: null }

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const at = (name) => header.findIndex((h) => h === name)
  const iCert = at('cert #')
  const iDesc = at('description')
  const iGrade = at('grade')
  const iService = at('after service')

  // Without a cert and a description there is nothing worth recording, and a
  // file this shape is almost certainly not a PSA order.
  if (iCert === -1 || iDesc === -1) {
    throw new Error('That does not look like a PSA order CSV — no "Cert #" and "Description" columns.')
  }

  const cards = []
  let skipped = 0

  for (const r of rows.slice(1)) {
    const cert = (r[iCert] || '').trim()
    const desc = (r[iDesc] || '').trim()
    if (!cert && !desc) { skipped++; continue }

    const parsed = parseDescription(desc)
    cards.push({
      cert,
      description: desc,
      name: parsed.name,
      set: parsed.set,
      number: parsed.number,
      year: parsed.year,
      gradeLabel: (r[iGrade] || '').trim(),
      grade: parseGrade(r[iGrade]),
      service: iService === -1 ? '' : (r[iService] || '').trim(),
    })
  }

  return { cards, skipped, order: null }
}

/**
 * What the order actually returned, measured against the grade you were after.
 *
 * A hit is at or above the target, not exactly on it. Targeting a 9 and getting
 * a 10 is not a miss, and counting it as one would understate how well a
 * submission went and push your planning rate down for no reason.
 *
 * The resulting rate is the same quantity the scenario planner asks you to
 * estimate before sending anything -- so this is the measured version of a
 * number that is otherwise a guess.
 */
export function summariseOrder(cards, targetGrade = 10) {
  const target = Number(targetGrade) || 10
  const graded = cards.filter((c) => c.grade != null)
  const hits = graded.filter((c) => c.grade >= target)
  const byGrade = new Map()
  for (const c of graded) byGrade.set(c.grade, (byGrade.get(c.grade) || 0) + 1)

  return {
    target,
    total: cards.length,
    graded: graded.length,
    ungraded: cards.length - graded.length,
    hits: hits.length,
    misses: graded.length - hits.length,
    hitRate: graded.length ? hits.length / graded.length : null,
    // Kept separate from the hit rate: PSA 10s are what most pricing is built
    // on, so it stays worth seeing even when you were aiming lower.
    gems: graded.filter((c) => c.grade === 10).length,
    distribution: [...byGrade.entries()].sort((a, b) => b[0] - a[0]),
  }
}
