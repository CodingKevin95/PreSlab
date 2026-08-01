import React, { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

const PREVIEW_W = 340
const RATIO = 1.396 // standard trading card aspect

/**
 * Card art with a hover preview and a graceful empty state.
 *
 * Cards saved before images were stored, and any whose CDN URL 404s, fall back
 * to a neutral placeholder rather than a broken-image icon -- a backlog row
 * should stay readable either way.
 */
export default function CardThumb({ src, alt = '', width = 38, big = false, preview = true }) {
  const [failed, setFailed] = useState(false)
  const [pos, setPos] = useState(null)
  const height = Math.round(width * RATIO)

  // The preview is rendered into document.body because the tables scroll
  // horizontally, and anything positioned inside them gets clipped.
  const show = useCallback((e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const h = PREVIEW_W * RATIO
    const gap = 12

    // Prefer the right of the thumbnail, flip left when there is no room.
    let x = r.right + gap
    if (x + PREVIEW_W > window.innerWidth - 8) x = r.left - PREVIEW_W - gap
    if (x < 8) x = 8

    // Vertically centre on the row, then keep it fully on screen.
    let y = r.top + r.height / 2 - h / 2
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8))

    setPos({ x, y })
  }, [])

  const hide = useCallback(() => setPos(null), [])

  if (!src || failed) {
    return (
      <div
        className="thumb-empty"
        style={{ width, height }}
        title={src ? 'Image failed to load' : 'No image — refresh this card to fetch one'}
        aria-hidden="true"
      />
    )
  }

  // The CDN serves several sizes off the same path.
  const at = (size) => src.replace('_200x200', `_${size}x${size}`)

  return (
    <>
      <img
        className="thumb"
        src={big ? at(400) : src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        onError={() => setFailed(true)}
        onMouseEnter={preview ? show : undefined}
        onMouseLeave={preview ? hide : undefined}
      />
      {preview && pos && createPortal(
        <img
          className="thumb-preview"
          src={at(800)}
          alt=""
          style={{ left: pos.x, top: pos.y, width: PREVIEW_W }}
        />,
        document.body
      )}
    </>
  )
}
