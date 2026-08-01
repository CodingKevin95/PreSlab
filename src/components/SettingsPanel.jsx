import React, { useState } from 'react'
import { DEFAULT_TIERS, PRICE_BASES, money } from '../lib/psa'
import { clearCache, getUserKey, setUserKey } from '../api/pricetracker'

export default function SettingsPanel({
  tiers, setTiers, settings, setSettings, cards, onImport,
}) {
  const [userKey, setUserKeyInput] = useState(getUserKey())
  const [savedKey, setSavedKey] = useState(false)
  function patchTier(id, patch) {
    setTiers(tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  function exportJson() {
    const blob = new Blob(
      [JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), cards, tiers, settings }, null, 2)],
      { type: 'application/json' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `psa-backlog-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function importJson(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result)
        if (!Array.isArray(parsed.cards)) throw new Error('No cards array in that file.')
        onImport(parsed)
      } catch (err) {
        alert('Could not read that file: ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <>
      <div className="panel">
        <h2>Your own API key</h2>
        <p className="sub">
          This app shares one pricing account, so heavy use can run into its daily
          limit. Paste your own free key and you get your own allowance instead —
          searches and refreshes stop competing with everyone else&apos;s.
        </p>
        <div className="row wrap">
          <div style={{ width: 380 }}>
            <input
              type="password"
              value={userKey}
              placeholder="pokeprice_..."
              onChange={(e) => setUserKeyInput(e.target.value)}
            />
          </div>
          <button
            className="primary"
            onClick={() => { setUserKey(userKey); setSavedKey(true) }}
          >
            Save key
          </button>
          {getUserKey() && (
            <button
              className="ghost danger"
              onClick={() => { setUserKey(''); setUserKeyInput(''); setSavedKey(false) }}
            >
              Remove
            </button>
          )}
          {savedKey && <span className="small" style={{ color: 'var(--good)' }}>Saved</span>}
        </div>
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
          Free keys come from{' '}
          <a href="https://www.pokemonpricetracker.com/api" target="_blank" rel="noreferrer"
             style={{ color: 'var(--accent)' }}>
            pokemonpricetracker.com/api
          </a>. It is stored in this browser and passed straight through to them —
          never saved on our side.
        </p>
      </div>

      <div className="panel">
        <h2>Which graded price to use</h2>
        <p className="sub">
          Graded sale data spans everything ever recorded, and old or unusual sales
          can sit a long way from what a card fetches today. This picks which figure
          drives every PSA value and net calculation in the app.
        </p>

        <div style={{ maxWidth: 340 }}>
          <select
            value={settings.priceBasis || 'smart'}
            onChange={(e) => setSettings({ ...settings, priceBasis: e.target.value })}
          >
            {PRICE_BASES.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {PRICE_BASES.find((b) => b.id === (settings.priceBasis || 'smart'))?.hint}
        </p>
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
          Grades with no sales in the recent window fall back to all-time data. When
          that happens the card says so rather than passing off an old number as current.
        </p>
      </div>

      <div className="panel">
        <h2>Submission costs</h2>
        <p className="sub">
          Shipping is split across the cards in a submission, so a card in a 20-card
          batch carries far less of it than a card sent on its own.
        </p>
        <div className="row wrap">
          <div style={{ width: 220 }}>
            <label className="small muted">Round-trip shipping + insurance</label>
            <input
              value={settings.shippingTotal}
              onChange={(e) => setSettings({ ...settings, shippingTotal: e.target.value })}
            />
          </div>
          <div style={{ width: 220 }}>
            <label className="small muted">Cards per submission</label>
            <input
              value={settings.shipmentSize}
              onChange={(e) => setSettings({ ...settings, shipmentSize: e.target.value })}
            />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <span className="small muted">
              = {money(Number(settings.shippingTotal || 0) / Math.max(1, Number(settings.shipmentSize) || 1))} per card
            </span>
          </div>
        </div>

        <div className="row wrap" style={{ marginTop: 14 }}>
          <div style={{ width: 220 }}>
            <label className="small muted">Selling fees (%)</label>
            <input
              value={settings.sellFeePct ?? '15'}
              onChange={(e) => setSettings({ ...settings, sellFeePct: e.target.value })}
            />
          </div>
          <div style={{ alignSelf: 'flex-end', maxWidth: 420 }}>
            <span className="small muted">
              What the marketplace takes when you sell. eBay runs about 13% plus payment
              processing; vendor buylists differ. Drives the <b>After fees</b> column.
            </span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>PSA service tiers</h2>
        <p className="sub">
          These ship as defaults and are almost certainly out of date &mdash; PSA moves its
          price list around and opens the cheap tiers only now and then. Edit them to match
          whatever PSA is actually charging. A card is auto-assigned the cheapest tier whose
          declared-value ceiling it fits under.
        </p>

        <div className="tier-row">
          <div className="hd">Tier</div>
          <div className="hd">Fee</div>
          <div className="hd">Max declared</div>
          <div className="hd">Min cards</div>
          <div></div>
        </div>

        {tiers.map((t) => (
          <div className="tier-row" key={t.id}>
            <input value={t.name} onChange={(e) => patchTier(t.id, { name: e.target.value })} />
            <input value={t.fee} onChange={(e) => patchTier(t.id, { fee: e.target.value })} />
            <input value={t.maxDeclared} onChange={(e) => patchTier(t.id, { maxDeclared: e.target.value })} />
            <input value={t.minCards} onChange={(e) => patchTier(t.id, { minCards: e.target.value })} />
            <button
              className="ghost danger"
              onClick={() => setTiers(tiers.filter((x) => x.id !== t.id))}
              title="Delete tier"
            >
              ✕
            </button>
          </div>
        ))}

        <div className="row" style={{ marginTop: 12 }}>
          <button
            onClick={() =>
              setTiers([
                ...tiers,
                { id: 'tier-' + Date.now(), name: 'New tier', fee: 0, maxDeclared: 0, minCards: 1, note: '' },
              ])
            }
          >
            Add tier
          </button>
          <button onClick={() => setTiers(DEFAULT_TIERS)}>Reset to defaults</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p className="sub">
          Everything lives in this browser&apos;s localStorage &mdash; nothing is uploaded
          anywhere. Export regularly if you care about it.
        </p>
        <div className="row wrap">
          <button onClick={exportJson}>Export JSON</button>
          <label className="row" style={{ margin: 0 }}>
            <span
              style={{
                display: 'inline-block', padding: '7px 12px', borderRadius: 8,
                border: '1px solid var(--line)', background: 'var(--panel-2)', cursor: 'pointer',
              }}
            >
              Import JSON
            </span>
            <input type="file" accept="application/json" onChange={importJson} style={{ display: 'none' }} />
          </label>
          <button
            onClick={() => {
              clearCache()
              alert('Price cache cleared. The next search or refresh will hit the API.')
            }}
          >
            Clear API cache
          </button>
        </div>
      </div>
    </>
  )
}
