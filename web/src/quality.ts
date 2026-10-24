// The quality songs are saved / downloaded at, on this device (a phone short of space can take smaller files).
// Streaming always plays the full-quality file.

export type Quality = 'high' | 'normal' | 'low'
// high: the file as downloaded (128–256 kbps, about 1–2 MB a minute; 1.4 is a fair guess for an estimate)
export const QUALITIES: { q: Quality; kbps: number; mbPerMin: number }[] = [
  { q: 'high', kbps: 0, mbPerMin: 1.4 },
  { q: 'normal', kbps: 96, mbPerMin: 0.72 },
  { q: 'low', kbps: 64, mbPerMin: 0.48 },
]
const KEY = 'yoinker.quality'

export function getQuality(): Quality {
  try {
    const q = localStorage.getItem(KEY)
    if (q === 'high' || q === 'normal' || q === 'low') return q
  } catch { /* private mode */ }
  return 'high'
}

export function setQuality(q: Quality) {
  try { localStorage.setItem(KEY, q) } catch { /* private mode */ }
}
