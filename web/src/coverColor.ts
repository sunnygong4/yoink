import { useEffect, useState } from 'react'

export type Palette = { bg: string; fg: string; fg2: string; dark: boolean }

const FALLBACK: Palette = { bg: 'rgb(48, 48, 52)', fg: '#fff', fg2: 'rgba(255, 255, 255, .65)', dark: true }

/** iTunes 11's album view: the page takes the cover's dominant colour, and the text whatever reads on it.
 * The cover is fetched through our server (/api/cover): other sites don't let a page read their pixels. */
export function useCoverPalette(url: string | null | undefined): Palette {
  const [p, setP] = useState<Palette>(FALLBACK)
  useEffect(() => {
    if (!url) { setP(FALLBACK); return }
    let live = true
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 32
        const ctx = c.getContext('2d')!
        ctx.drawImage(img, 0, 0, 32, 32)
        const px = ctx.getImageData(0, 0, 32, 32).data
        // 4-bit buckets, saturated colours count more; the most common one wins
        const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
        for (let i = 0; i < px.length; i += 4) {
          const [r, g, b] = [px[i], px[i + 1], px[i + 2]]
          const sat = Math.max(r, g, b) - Math.min(r, g, b)
          const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
          const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
          const w = 1 + sat / 64
          e.n += w; e.r += r * w; e.g += g * w; e.b += b * w
          buckets.set(k, e)
        }
        const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0]
        const [r, g, b] = [top.r / top.n, top.g / top.n, top.b / top.n].map(Math.round)
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        const dark = lum < 0.6
        if (live) setP({ bg: `rgb(${r}, ${g}, ${b})`, fg: dark ? '#fff' : '#111', fg2: dark ? 'rgba(255, 255, 255, .68)' : 'rgba(0, 0, 0, .6)', dark })
      } catch { if (live) setP(FALLBACK) }
    }
    img.onerror = () => { if (live) setP(FALLBACK) }
    img.src = url.startsWith('/') ? url : `/api/cover?${new URLSearchParams({ url })}`
    return () => { live = false }
  }, [url])
  return p
}
