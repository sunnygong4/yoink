import { useState } from 'react'
import { api, type Song } from './api'
import { t } from './i18n'

/** Fix a song's name, artist, album and cover (for everyone: the server has one copy of each song). */
export default function EditSong({ song, onClose, onSaved }: { song: Song; onClose: () => void; onSaved: (s: Song) => void }) {
  const [title, setTitle] = useState(song.title)
  const [artist, setArtist] = useState(song.artist)
  const [album, setAlbum] = useState(song.album ?? '')
  const [cover, setCover] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = cover ? URL.createObjectURL(cover) : song.thumbnail

  async function save() {
    setBusy(true)
    setError('')
    try {
      let s = await api.editSong(song.id, { title, artist, album })
      if (cover) s = await api.songCover(song.id, cover)
      onSaved(s)
      onClose()
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal window edit-song" role="dialog" aria-modal="true" aria-label={t('editSong')}>
        <div className="titlebar">
          <span className="lights">
            {/* (a span, not a <button> titled "Close": some browser extensions put their own icon on those) */}
            <span className="light close" role="button" tabIndex={0} aria-label={t('closeWindow')} onClick={onClose}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClose() } }} />
            <i className="light" /><i className="light" />
          </span>
          <h2>{t('editSong')}</h2>
        </div>
        <div className="es-body">
          <label className="es-cover" title={t('changeCover')}>
            {preview ? <img src={preview} alt="" /> : <span>♫</span>}
            <span className="es-cover-hint">{t('changeCover')}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setCover(e.target.files?.[0] ?? null)} />
          </label>
          <div className="es-fields">
            <label>{t('colName')}<input value={title} onChange={e => setTitle(e.target.value)} autoFocus /></label>
            <label>{t('colArtist')}<input value={artist} onChange={e => setArtist(e.target.value)} placeholder={t('artistUnknown')} /></label>
            <label>{t('colAlbum')}<input value={album} onChange={e => setAlbum(e.target.value)} /></label>
            {song.source_title && song.source_title !== title && <p className="muted small">{t('fromVideo', { title: song.source_title })}</p>}
            <p className="muted small">{t('editForEveryone')}</p>
          </div>
        </div>
        {error && <p className="error pad">{error}</p>}
        <footer className="modal-buttons">
          <button onClick={onClose}>{t('podCancel')}</button>
          <button className="blue" disabled={busy || !title.trim()} onClick={save}>{busy ? '…' : t('save')}</button>
        </footer>
      </div>
    </div>
  )
}
