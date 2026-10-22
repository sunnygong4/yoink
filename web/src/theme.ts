// Display mode: "classic" (iTunes-era Apple) or "yoinker" (the dark look). Remembered per device.

export type Theme = 'classic' | 'yoinker'
const SAVED = 'yoinker.theme'

function load(): Theme {
  try {
    const t = localStorage.getItem(SAVED)
    if (t === 'classic' || t === 'yoinker') return t
  } catch { /* private mode */ }
  return 'classic'
}

let theme: Theme = load()
const apply = () => {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'classic' ? '#cfcfcf' : '#0e0e12')
}
apply()

export const getTheme = () => theme

export function setTheme(t: Theme) {
  theme = t
  apply()
  try { localStorage.setItem(SAVED, t) } catch { /* private mode */ }
}
