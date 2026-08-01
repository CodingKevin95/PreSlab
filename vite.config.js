import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const UPSTREAM = 'www.pokemonpricetracker.com'

/**
 * Persists the backlog to a real file on disk instead of relying on the
 * browser. localStorage is wiped by "clear cookies and site data", by
 * switching browsers, and by incognito -- none of which should be able to
 * destroy someone's grading queue.
 *
 * Writes are atomic (temp file then rename) so an interrupted save cannot
 * leave a half-written file behind, and the previous version is kept as a
 * .bak alongside it.
 */
function dataStore(root) {
  const dir = path.join(root, 'data')
  const file = path.join(dir, 'backlog.json')
  const bak = path.join(dir, 'backlog.bak.json')

  return {
    name: 'psa-data-store',
    configureServer(server) {
      server.middlewares.use('/api/data', (req, res) => {
        res.setHeader('content-type', 'application/json')

        if (req.method === 'GET') {
          try {
            if (!fs.existsSync(file)) return res.end(JSON.stringify({ empty: true }))
            return res.end(fs.readFileSync(file, 'utf8'))
          } catch (err) {
            res.statusCode = 500
            return res.end(JSON.stringify({ error: err.message }))
          }
        }

        if (req.method === 'PUT' || req.method === 'POST') {
          const chunks = []
          req.on('data', (c) => chunks.push(c))
          req.on('end', () => {
            try {
              const body = Buffer.concat(chunks).toString('utf8')
              // Refuse to persist anything that isn't valid JSON, so a bad
              // request can never clobber a good file.
              JSON.parse(body)

              fs.mkdirSync(dir, { recursive: true })
              if (fs.existsSync(file)) fs.copyFileSync(file, bak)

              const tmp = file + '.tmp'
              fs.writeFileSync(tmp, body, 'utf8')
              fs.renameSync(tmp, file)

              return res.end(JSON.stringify({
                ok: true,
                bytes: Buffer.byteLength(body),
                savedAt: Date.now(),
                path: file,
              }))
            } catch (err) {
              res.statusCode = 400
              return res.end(JSON.stringify({ error: err.message }))
            }
          })
          return
        }

        res.statusCode = 405
        res.end(JSON.stringify({ error: 'Method not allowed' }))
      })
    },
  }
}

// Usage headers the client reads back to keep its credit meter honest.
const PASS_THROUGH = [
  'x-ratelimit-daily-limit',
  'x-ratelimit-daily-remaining',
  'x-ratelimit-daily-reset',
  'x-ratelimit-minute-remaining',
  'x-api-calls-consumed',
  'x-api-calls-breakdown',
]

/**
 * Forwards /api/tcg/* to the Pokemon Price Tracker API, attaching the bearer
 * token server-side so it never reaches the browser bundle.
 *
 * Hand-rolled rather than Vite's `server.proxy` because http-proxy applies
 * header injection inconsistently once a request carries a body -- GETs were
 * authenticated but POSTs arrived upstream with no credentials at all.
 */
function pricetrackerProxy(apiKey) {
  return {
    name: 'pricetracker-proxy',
    configureServer(server) {
      server.middlewares.use('/api/tcg', (req, res) => {
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          const body = Buffer.concat(chunks)

          const headers = {
            authorization: `Bearer ${apiKey}`,
            accept: 'application/json',
          }
          if (body.length) {
            headers['content-type'] = 'application/json'
            headers['content-length'] = Buffer.byteLength(body)
          }

          const upstream = https.request(
            { hostname: UPSTREAM, path: '/api/v2' + req.url, method: req.method, headers },
            (up) => {
              res.statusCode = up.statusCode || 502
              res.setHeader('content-type', up.headers['content-type'] || 'application/json')
              // The credit meter lives in the browser, so it needs these.
              for (const h of PASS_THROUGH) {
                if (up.headers[h]) res.setHeader(h, up.headers[h])
              }
              up.pipe(res)
            }
          )

          upstream.on('error', (err) => {
            res.statusCode = 502
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ error: `Upstream request failed: ${err.message}` }))
          })

          if (body.length) upstream.write(body)
          upstream.end()
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.POKEMONPRICETRACKER_API_KEY || ''

  if (!apiKey) {
    console.warn('\n  [psa-backlog] POKEMONPRICETRACKER_API_KEY is not set. Copy .env.example to .env.local and add your key.\n')
  }

  return {
    plugins: [react(), pricetrackerProxy(apiKey), dataStore(process.cwd())],
    // The port is pinned deliberately. Your backlog lives in localStorage,
    // which is scoped per origin -- including the port. If Vite were allowed to
    // drift to the next free port, the app would come up looking empty and the
    // old data would be stranded on the previous origin. strictPort makes a
    // conflict fail loudly instead of silently losing sight of your data.
    server: { port: 5190, strictPort: true },
  }
})
