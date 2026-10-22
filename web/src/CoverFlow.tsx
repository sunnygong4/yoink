import { useEffect, useRef } from 'react'
import { t } from './i18n'
import * as I from './icons'

export type FlowAlbum = { key: string; album: string; artist: string; cover: string | null; count: number }

/** iTunes' Cover Flow: the library's albums in one row; the picked one faces you, the rest turn away. */
export default function CoverFlow({ albums, picked, onPick, onPlay, onOpen }: {
  albums: FlowAlbum[]
  picked: string | null
  onPick: (key: string | null) => void
  onPlay: (key: string) => void
  onOpen: (a: FlowAlbum) => void
}) {
  const row = useRef<HTMLDivElement>(null)
  const at = albums.findIndex(a => a.key === picked)

  // keep the picked album in the middle
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>('.flow-item.center')
    const box = row.current
    if (el && box) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
  }, [picked])

  // arrow keys walk the row (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || !albums.length) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const i = at < 0 ? 0 : Math.max(0, Math.min(albums.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)))
      onPick(albums[i].key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [albums, at, onPick])

  const current = at >= 0 ? albums[at] : null
  return (
    <div className={'coverflow' + (current ? ' focused' : '')}>
      <div className="flow-row" ref={row}>
        {albums.map((a, i) => {
          const side = at < 0 ? '' : i < at ? ' left' : i > at ? ' right' : ' center'
          return (
            <button key={a.key} className={'flow-item' + side} style={{ zIndex: at < 0 ? 1 : 100 - Math.abs(i - at) }}
              onClick={() => onPick(a.key === picked ? null : a.key)} onDoubleClick={() => onPlay(a.key)} title={`${a.album} — ${a.artist}`}>
              {a.cover ? <img src={a.cover} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                : <span className="flow-blank">♫</span>}
            </button>
          )
        })}
      </div>
      <div className="flow-caption">
        {current ? <>
          <a className="flow-title" onClick={() => onOpen(current)}>{current.album}</a>
          <span className="flow-sub">{current.artist} · {t('nSongs', { n: current.count })}</span>
          <span className="flow-actions">
            <button onClick={() => onPlay(current.key)}><I.Play size={11} /> {t('play')}</button>
            <button onClick={() => onPick(null)}>{t('showAll')}</button>
          </span>
        </> : <span className="flow-sub">{t('flowHint', { n: albums.length })}</span>}
      </div>
    </div>
  )
}
