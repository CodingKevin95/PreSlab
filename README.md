# PreSlab

A tracker for cards you're holding back until PSA's cheaper grading tiers open.
It answers the question that actually matters for each card: **is grading this
worth it, or should I just sell it raw?**

Pricing comes from the [Pokemon Price Tracker API](https://www.pokemonpricetracker.com/docs):
raw market prices from TCGplayer, and **graded sale averages scraped from eBay**
(PSA, BGS, CGC, SGC) with the sale count behind every figure.

Pokemon only, English and Japanese.

## What it does

**Backlog** — search a card, click the printing you own, and it lands in your list
with its raw price and every graded sale average already attached. Each row shows
what one copy is worth raw, what it's worth at your target grade, and the net gain
after grading fees and selling fees.

**Cost basis** — record what you actually paid, per copy. Buying the same card
three times at three prices is normal, so each copy holds its own price and the
row shows the average. Copies you haven't priced count at market value.

**Submissions** — tick cards, choose how many copies of each to send, and group
them into a batch. The batch's real card count then drives the shipping split and
service-tier eligibility, so the economics stop being estimates.

**Gem-rate scenarios** — enter the share of cards you expect to hit the target
grade and the batch shows worst, expected and best case. The range comes from
*which* cards hit, not just how many, which is usually the bigger swing.

**CSV export** — any submission, or all of them, as a spreadsheet.

## Two things to know

**The tier table is a starting point.** PSA changes its price list and opens the
cheap tiers only sometimes. Bulk is absent because it's currently closed. Check
PSA's current prices and edit the tiers in Settings — every cost figure depends
on them.

**Graded coverage follows eBay sales.** A grade only has a price if graded copies
have actually sold. Established chase cards have deep data; cards released in the
last few months usually have none. "None" is an honest answer, not a bug — the app
falls back to showing what a graded copy would need to fetch to break even.

Every grade tile shows its **sale count**. An average off 300 sales and one off a
single sale are very different claims.

## Running it locally

```bash
npm install
cp .env.example .env.local   # paste your key in
npm run dev
```

Open http://localhost:5190.

Locally, your backlog is written to `data/backlog.json` — a real file, safe from
clearing browser data. Hosted, it lives in your browser instead; **export from
Settings** to keep a copy.

## Deploying

Push to GitHub and import the repo in Vercel. Two things to set:

- **Environment variable** `POKEMONPRICETRACKER_API_KEY` — the shared key the
  deployment uses.
- Nothing else. `vercel.json` handles the build and SPA routing.

`api/tcg/[...path].js` relays API calls server-side so the key never reaches the
browser. A relay is required rather than optional: the upstream API answers CORS
preflights with `401` before its CORS handler runs, so browsers can't call it
directly even with a valid key.

Visitors can paste **their own key** in Settings to use their own allowance
instead of the deployment's. It's kept in their browser, sent as a header, and
never stored server-side.

## The credit budget

Credits are charged **per card, not per request** — a search returning 20 results
costs 20. Free keys get 100/day, the paid API plan 20,000/day. Both are capped at
**60 requests/minute**, which is the limit that actually bites.

| Action | Cost |
|---|---|
| Search | 1 credit per result |
| Add a card | 2 (price + every graded sale average) |
| Refresh prices | 1 per unique card |
| Refresh one card + comps | 2 |

Searches cache for 6h and graded data for 24h, so repeats are free. The header
counter reads the API's own remaining-credit header rather than guessing, and
requests are paced against a rolling 60-second window that survives page reloads.

## Your data

No accounts, no server-side storage. Locally it's a JSON file in the project;
hosted it's browser storage. **Export JSON** in Settings writes a backup and
**Import JSON** restores one — that's the only thing standing between you and a
cleared cache, so use it.
