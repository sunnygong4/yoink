// Small line icons (24x24, currentColor) so controls look the same on every device, unlike emoji/unicode glyphs.

type P = { size?: number }

function svg(path: React.ReactNode, { size = 20 }: P, filled = false) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  )
}

export const Play = (p: P) => svg(<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />, p, true)
export const Pause = (p: P) => svg(<><rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" /></>, p, true)
export const Prev = (p: P) => svg(<><path d="M18 6.2v11.6a.8.8 0 0 1-1.25.66L8.5 12.66a.8.8 0 0 1 0-1.32l8.25-5.8A.8.8 0 0 1 18 6.2z" /><rect x="5" y="5.5" width="2.5" height="13" rx="1" /></>, p, true)
export const Next = (p: P) => svg(<><path d="M6 6.2v11.6a.8.8 0 0 0 1.25.66l8.25-5.8a.8.8 0 0 0 0-1.32l-8.25-5.8A.8.8 0 0 0 6 6.2z" /><rect x="16.5" y="5.5" width="2.5" height="13" rx="1" /></>, p, true)
export const Shuffle = (p: P) => svg(<><path d="M16 3h5v5" /><path d="M4 20 21 3" /><path d="M21 16v5h-5" /><path d="m15 15 6 6" /><path d="M4 4l5 5" /></>, p)
export const Repeat = (p: P) => svg(<><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></>, p)
export const RepeatOne = (p: P) => svg(<><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /><path d="M11 10h1v4" /></>, p)
export const Sparkle = (p: P) => svg(<><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" /><path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z" /></>, p)
export const QueueIcon = (p: P) => svg(<><path d="M3 6h13" /><path d="M3 12h13" /><path d="M3 18h8" /><path d="M17 15v6l4-3z" /></>, p)
export const Expand = (p: P) => svg(<><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /></>, p)
export const Close = (p: P) => svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>, p)
export const Down = (p: P) => svg(<path d="m6 9 6 6 6-6" />, p)
export const Plus = (p: P) => svg(<><path d="M12 5v14" /><path d="M5 12h14" /></>, p)
export const PlayNext = (p: P) => svg(<><path d="M3 6h11" /><path d="M3 12h7" /><path d="M3 18h7" /><path d="M14 12h7" /><path d="m18 9 3 3-3 3" /></>, p)
export const Download = (p: P) => svg(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>, p)
export const Heart = (p: P) => svg(<path d="M19.5 12.6 12 20l-7.5-7.4A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 7.5 6.5z" />, p)
export const Search = (p: P) => svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, p)
export const Library = (p: P) => svg(<><path d="M4 4v16" /><path d="M8 4v16" /><path d="m12 4.5 4 15.5" /><path d="M17 4h3v16h-3" /></>, p)
export const Upload = (p: P) => svg(<><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></>, p)
export const Volume = (p: P) => svg(<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>, p)
export const Mute = (p: P) => svg(<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></>, p)
