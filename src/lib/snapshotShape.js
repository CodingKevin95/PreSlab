/**
 * Expands a snapshot row back into the card shape the app works with.
 *
 * The stored form uses short keys because it is written once and read many
 * times, and the difference across several thousand cards is most of the file.
 * Nothing outside this module should know about them: the rest of the app sees
 * exactly what the API path produces, so a card behaves the same whether it
 * came from the snapshot or from a live lookup.
 */
export function slimToCard(c) {
  const byCompany = {}
  const psa = {}
  for (const [grade, v] of Object.entries(c.psa || {})) {
    psa[grade] = {
      price: v.price,
      median: v.median ?? null,
      min: null,
      max: null,
      count: v.count ?? 0,
      avg7d: v.avg7d ?? null,
      median7d: v.median7d ?? null,
      volume7d: null,
      smart: v.smart ?? null,
      smartConfidence: v.sc ?? null,
      smartMethod: null,
      smartDays: v.sd ?? null,
      trend: v.trend || null,
      lastSale: v.last || null,
    }
  }
  if (Object.keys(psa).length) byCompany.PSA = psa

  return {
    tcgPlayerId: String(c.id),
    pptId: null,
    name: c.n,
    setName: c.s,
    setId: c.setId ?? null,
    number: c.num,
    rarity: c.r,
    image: c.img || null,
    marketPrice: c.mp ?? null,
    lastUpdated: c.up || null,
    printings: (c.pt || []).map((p) => ({
      printing: p.p,
      price: p.pr ?? null,
      low: p.lo ?? null,
      condition: p.cond || 'Near Mint',
    })),
    graded: Object.keys(byCompany).length ? { byCompany, updatedAt: c.up || null } : null,
    // Marks where this came from, so the UI can say a price is from the shipped
    // snapshot rather than fetched just now.
    fromSnapshot: true,
  }
}
