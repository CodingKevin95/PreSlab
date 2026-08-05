import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Landing from './Landing'
import './styles.css'

/**
 * Two pages, no router.
 *
 * A router would be a dependency and a build step for a single either/or, and
 * the hosting already rewrites every non-API path to this file, so the path is
 * readable here directly.
 *
 * "/" is the front door and "/app" is the tool, which keeps both linkable --
 * you can send someone the pitch or send them straight to work, and anyone who
 * bookmarks the app never sees the pitch again.
 */
const isApp = window.location.pathname.replace(/\/+$/, '') === '/app'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isApp ? <App /> : <Landing />}
  </React.StrictMode>
)
