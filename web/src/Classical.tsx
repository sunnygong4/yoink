import { useEffect, useMemo, useState } from 'react'
import { api, type CatalogSong, type ClassicalWork, type ComposerPage as Composer, type SavedScore, type ScoreEdition } from './api'
import { getLang, t } from './i18n'
import * as I from './icons'
import type { Page } from './Pages'

// The Classical catalog: composers, their works and the works' scores, from IMSLP (the Petrucci Music Library).
// Scores open on IMSLP's own pages (its copyright notice and download); the ones you keep are in My scores.

// IMSLP's names for a work's details, in Chinese
const INFO_ZH: Record<string, string> = {
  'Alternative Title': '别名', 'Opus/Catalogue Number': '作品号', 'Key': '调性', 'Movements/Sections': '乐章',
  'Year/Date of Composition': '创作年代', 'Year of First Publication': '首次出版', 'First Performance': '首演',
  'Dedication': '题献', 'Librettist': '脚本', 'Language': '语言', 'Piece Style': '风格', 'Instrumentation': '编制',
}
// the genres works are grouped by (from IMSLP's categories), in English and Chinese
const GENRE: Record<string, [string, string]> = {
  opera: ['Operas', '歌剧'], ballet: ['Ballets', '芭蕾'], stage: ['Stage music', '戏剧配乐'], symphony: ['Symphonies', '交响曲'],
  'symphonic-poem': ['Symphonic poems', '交响诗'], overture: ['Overtures', '序曲'], concerto: ['Concertos', '协奏曲'],
  suite: ['Suites & partitas', '组曲'], serenade: ['Serenades', '小夜曲'], sonata: ['Sonatas', '奏鸣曲'], variations: ['Variations', '变奏曲'],
  chamber: ['Chamber music', '室内乐'], mass: ['Masses & requiems', '弥撒 / 安魂曲'], cantata: ['Cantatas', '康塔塔'],
  oratorio: ['Oratorios & passions', '清唱剧 / 受难曲'], sacred: ['Sacred music', '宗教音乐'], chorale: ['Chorales', '众赞歌'],
  'chorale-prelude': ['Chorale preludes', '众赞歌前奏曲'], song: ['Songs', '歌曲'], aria: ['Arias', '咏叹调'],
  prelude: ['Preludes', '前奏曲'], fugue: ['Fugues', '赋格'], toccata: ['Toccatas', '托卡塔'], fantasia: ['Fantasias', '幻想曲'],
  invention: ['Inventions', '创意曲'], canon: ['Canons', '卡农'], etude: ['Études', '练习曲'], nocturne: ['Nocturnes', '夜曲'],
  waltz: ['Waltzes', '圆舞曲'], mazurka: ['Mazurkas', '玛祖卡'], polonaise: ['Polonaises', '波兰舞曲'], ballade: ['Ballades', '叙事曲'],
  scherzo: ['Scherzos', '谐谑曲'], impromptu: ['Impromptus', '即兴曲'], rhapsody: ['Rhapsodies', '狂想曲'], romance: ['Romances', '浪漫曲'],
  march: ['Marches', '进行曲'], dance: ['Dances', '舞曲'], rondo: ['Rondos', '回旋曲'],
}
const genreLabel = (g: string) => (GENRE[g] ? GENRE[g][getLang() === 'zh' ? 1 : 0] : g)
const infoLabel = (k: string) => (getLang() === 'zh' ? INFO_ZH[k] ?? k : k)

const composerName = (c: { name: string; zh?: string | null }) => (getLang() === 'zh' && c.zh ? `${c.zh} · ${c.name}` : c.name)

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setData(null)
    setError('')
    load().then(d => { if (live) setData(d) }).catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false }
  }, deps)
  return { data, error }
}

/** Which scores this person keeps: work page -> files ('' = the whole work) -> the saved row's id. */
function useSaved() {
  const [rows, setRows] = useState<SavedScore[]>([])
  const load = () => api.scores().then(setRows).catch(() => {})
  useEffect(() => { load() }, [])
  const find = (work: string, file?: string) => rows.find(r => r.work === work && (r.file || '') === (file || ''))
  async function toggle(work: string, file?: string, label?: string) {
    const have = find(work, file)
    if (have) await api.unsaveScore(have.id)
    else await api.saveScore(work, file, label)
    load()
  }
  return { find, toggle }
}

export function ClassicalHome({ open }: { open: (p: Page) => void }) {
  const { data, error } = useLoad(() => api.classical(), [])
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ q: string; composers: Composer[]; works: ClassicalWork[] } | null>(null)
  const [busy, setBusy] = useState(false)

  async function find(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) { setRes(null); return }
    setBusy(true)
    try { setRes({ q: q.trim(), ...(await api.classicalSearch(q.trim())) }) } catch (err) { alert((err as Error).message) }
    setBusy(false)
  }

  return (
    <div className="page classical">
      <div className="cl-hero">
        <h1>{t('classical')}</h1>
        <p className="muted">{t('classicalIntro')}</p>
        <form className="cl-search" onSubmit={find}>
          <label className="searchfield">
            <I.Search size={12} />
            <input placeholder={t('classicalSearch')} value={q} onChange={e => setQ(e.target.value)} enterKeyHint="search" />
          </label>
          <button className="blue" type="submit" disabled={busy}>{busy ? '…' : t('search')}</button>
        </form>
      </div>

      {res && (
        <section>
          <h2 className="section-title">{t('classicalResults', { q: res.q })}</h2>
          {res.composers.length === 0 && res.works.length === 0 && <p className="muted pad">{t('noResults')}</p>}
          {res.composers.length > 0 && (
            <div className="cl-chips">
              {res.composers.map(c => (
                <button key={c.category} className="pill" onClick={() => open({ kind: 'composer', name: c.category })}>{composerName(c)}</button>
              ))}
            </div>
          )}
          <ul className="cl-works">
            {res.works.map(w => (
              <li key={w.page}>
                <a onClick={() => open({ kind: 'work', page: w.page })}>{w.name}</a>
                {w.composer && <span className="muted"> — {w.composer}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="section-title">{t('composers')}</h2>
        {error && <p className="error pad">{error}</p>}
        {!data && !error && <p className="muted pad">{t('loading')}</p>}
        <div className="cl-composers">
          {data?.composers.map(c => (
            <button key={c.category} className="cl-composer" onClick={() => open({ kind: 'composer', name: c.category })}>
              {c.image ? <img src={c.image} alt="" loading="lazy" /> : <span className="cl-blank">♪</span>}
              <span className="name">{getLang() === 'zh' && c.zh ? c.zh : c.name}</span>
              {getLang() === 'zh' && c.zh && <span className="sub">{c.name}</span>}
            </button>
          ))}
        </div>
      </section>
      <p className="muted small pad">{t('imslpCredit')}</p>
    </div>
  )
}

// a work's name to search recordings by: without IMSLP's (Composer, Name) tail
const shortName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '')
// the words that say which work a recording is (catalogue numbers, titles), for telling a real match from a near one
const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(x => x.length > 2)

// 随机播放: random works of this composer (the ones the filter shows), each as a recording from the catalog;
// the first plays now, a few more go in the queue behind it
async function shuffleWorks(composer: string, works: ClassicalWork[], preview: (c: CatalogSong, how: 'now' | 'end') => Promise<void>, started: () => void) {
  const pool = [...works].sort(() => Math.random() - 0.5)
  let played = 0
  const recording = async (w: ClassicalWork) => {
    const name = shortName(w.name)
    const found = await api.catalog(`${composer} ${name}`).catch(() => null)
    const want = new Set(words(name))
    return found?.songs.find(x => words(`${x.title} ${x.album ?? ''}`).some(k => want.has(k)))
  }
  // a few works looked up at once (most have a recording; some don't)
  for (let i = 0; i < 16 && played < 5; i += 4) {
    for (const hit of await Promise.all(pool.slice(i, i + 4).map(recording))) {
      if (!hit || played >= 5) continue
      try {
        await preview(hit, played === 0 ? 'now' : 'end')
        if (++played === 1) started()
      } catch { /* that one couldn't be fetched: the next */ }
    }
  }
  if (!played) { started(); alert(t('shuffleNothing')) }
}

export function ComposerPage({ name, open, preview }: { name: string; open: (p: Page) => void; preview: (c: CatalogSong, how: 'now' | 'end') => Promise<void> }) {
  const { data: c, error } = useLoad(() => api.composer(name), [name])
  const [filter, setFilter] = useState('')
  const [shuffling, setShuffling] = useState(false)
  // the works by genre: loaded after the works themselves (it takes IMSLP a moment)
  const [tags, setTags] = useState<Record<string, string[]> | null>(null)
  const [genre, setGenre] = useState('')
  useEffect(() => { api.classicalGenres(name).then(setTags).catch(() => setTags({})) }, [name])
  const counts = useMemo(() => {
    const n: Record<string, number> = {}
    for (const gs of Object.values(tags ?? {})) for (const g of gs) n[g] = (n[g] ?? 0) + 1
    return Object.entries(n).sort((a, b) => b[1] - a[1])
  }, [tags])
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    let ws = c?.works ?? []
    if (genre) ws = ws.filter(w => tags?.[w.page]?.includes(genre))
    return f ? ws.filter(w => w.name.toLowerCase().includes(f)) : ws
  }, [c, filter, genre, tags])

  if (error) return <p className="error pad">{error}</p>
  if (!c) return <p className="muted pad">{t('loading')}</p>
  return (
    <div className="page classical">
      <div className="cl-head">
        {c.image ? <img className="cl-photo" src={c.image} alt="" /> : <span className="cl-photo cl-blank">♪</span>}
        <div className="cl-head-text">
          <h1>{getLang() === 'zh' && c.zh ? c.zh : c.name}</h1>
          {getLang() === 'zh' && c.zh && <p className="muted">{c.name}</p>}
          {c.extract && <p className="cl-extract">{c.extract}</p>}
          <p className="muted small">{t('nWorks', { n: c.works.length })} · <a href={c.imslp} target="_blank" rel="noreferrer">IMSLP ↗</a></p>
          <div className="ia-buttons cl-buttons">
            <button className="blue" disabled={shuffling || !shown.length} title={t('shuffleWorksHint')}
              onClick={() => { setShuffling(true); shuffleWorks(c.name, shown, preview, () => setShuffling(false)) }}>
              <I.Shuffle size={11} /> {shuffling ? t('shuffleFinding') : genre || filter ? t('shuffleShown', { n: shown.length }) : t('shuffleWorks')}
            </button>
          </div>
        </div>
      </div>
      {counts.length > 0 && (
        <nav className="cl-genres">
          <button className={genre ? '' : 'on'} onClick={() => setGenre('')}>{t('allWorks')} <span>{c.works.length}</span></button>
          {counts.map(([g, n]) => (
            <button key={g} className={genre === g ? 'on' : ''} onClick={() => setGenre(genre === g ? '' : g)}>{genreLabel(g)} <span>{n}</span></button>
          ))}
        </nav>
      )}
      <div className="listbar">
        <label className="searchfield">
          <I.Search size={12} />
          <input placeholder={t('filterWorks')} value={filter} onChange={e => setFilter(e.target.value)} />
        </label>
        <span className="muted small">{(filter || genre) && t('nWorks', { n: shown.length })}</span>
      </div>
      <table className="songlist cl-worklist">
        <thead><tr><th className="c-cat">{t('catalogueNo')}</th><th>{t('work')}</th></tr></thead>
        <tbody>
          {shown.slice(0, 2000).map(w => (
            <tr key={w.page} onClick={() => open({ kind: 'work', page: w.page })}>
              <td className="c-cat">{w.catalogue}</td>
              <td className="c-name"><a>{w.name}</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function WorkPage({ page, open }: { page: string; open: (p: Page) => void }) {
  const { data: w, error } = useLoad(() => api.work(page), [page])
  const saved = useSaved()
  const [kind, setKind] = useState<'score' | 'arrangement'>('score')

  if (error) return <p className="error pad">{error}</p>
  if (!w) return <p className="muted pad">{t('loading')}</p>
  const groups = w.scores.filter(s => s.kind === kind)
  const arrangements = w.scores.filter(s => s.kind === 'arrangement').length
  const whole = saved.find(w.page)
  const short = w.name.replace(/\s*\([^)]*\)\s*$/, '')

  return (
    <div className="page classical">
      <div className="cl-work-head">
        <h1>{w.name}</h1>
        <p><a onClick={() => open({ kind: 'composer', name: w.composer })}>{composerName({ name: w.composer_name, zh: w.composer_zh })}</a></p>
        <div className="ia-buttons cl-buttons">
          <button className={whole ? 'pressed' : 'blue'} onClick={() => saved.toggle(w.page, undefined, w.name)}>
            {whole ? `✓ ${t('scoreSaved')}` : <><I.Plus size={11} /> {t('saveScore')}</>}
          </button>
          <button onClick={() => open({ kind: 'search', q: `${w.composer_name} ${short}` })}><I.Play size={11} /> {t('findRecordings')}</button>
          <a className="button-link" href={w.imslp} target="_blank" rel="noreferrer">IMSLP ↗</a>
        </div>
      </div>

      {Object.keys(w.info).length > 0 && (
        <table className="cl-info">
          <tbody>
            {Object.entries(w.info).filter(([k]) => k !== 'Work Title').map(([k, v]) => (
              <tr key={k}><th>{infoLabel(k)}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="listbar">
        <nav className="seg">
          <button className={kind === 'score' ? 'on' : ''} onClick={() => setKind('score')}>{t('scoresTab', { n: w.scores.length - arrangements })}</button>
          <button className={kind === 'arrangement' ? 'on' : ''} onClick={() => setKind('arrangement')} disabled={!arrangements}>
            {t('arrangementsTab', { n: arrangements })}</button>
        </nav>
        {w.recordings > 0 && <span className="muted small">{t('imslpRecordings', { n: w.recordings })}</span>}
      </div>
      {groups.length === 0 && <p className="muted pad">{t('noScores')}</p>}
      <div className="cl-editions">
        {groups.map((g, i) => <Edition key={i} g={g} work={w.page} saved={saved} />)}
      </div>
      <p className="muted small pad">{t('imslpFileNote')}</p>
    </div>
  )
}

function Edition({ g, work, saved }: { g: ScoreEdition; work: string; saved: ReturnType<typeof useSaved> }) {
  return (
    <div className="cl-edition">
      <div className="cl-ed-head">
        {g.group && <b>{g.group}</b>}
        {g.copyright && <span className={'tag' + (/public domain/i.test(g.copyright) ? ' good' : '')}>{g.copyright}</span>}
        {g.type && <span className="tag">{g.type}</span>}
      </div>
      {(g.editor || g.publisher) && <p className="muted small">{[g.editor && `${t('editor')}: ${g.editor}`, g.publisher].filter(Boolean).join(' · ')}</p>}
      <ul>
        {g.files.map(f => {
          const have = saved.find(work, f.file)
          return (
            <li key={f.file}>
              <I.Score size={13} />
              <a href={f.url} target="_blank" rel="noreferrer" title={f.file}>{f.label}</a>
              <button className={'mini' + (have ? ' pressed' : '')} title={have ? t('scoreSaved') : t('saveScore')}
                onClick={() => saved.toggle(work, f.file, `${f.label}${g.publisher ? ` · ${g.publisher}` : ''}`.slice(0, 200))}>
                {have ? '✓' : <I.Plus size={11} />}
              </button>
            </li>
          )
        })}
      </ul>
      {g.notes && <p className="muted small">{g.notes}</p>}
    </div>
  )
}

/** My scores: the works and score files this person kept. */
export function ScoresPage({ open }: { open: (p: Page) => void }) {
  const [rows, setRows] = useState<SavedScore[] | null>(null)
  const load = () => api.scores().then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [])
  if (!rows) return <p className="muted pad">{t('loading')}</p>
  return (
    <div className="page classical">
      <div className="cl-hero">
        <h1>{t('myScores')}</h1>
        <p className="muted">{t('myScoresIntro')}</p>
      </div>
      {rows.length === 0
        ? <div className="empty"><p>{t('noSavedScores')}</p><button onClick={() => open({ kind: 'classical' })}>{t('classical')}</button></div>
        : (
          <table className="songlist cl-saved">
            <thead><tr><th>{t('work')}</th><th className="c-artist">{t('composer')}</th><th>{t('scoreFile')}</th><th className="c-act" /></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="c-name"><a onClick={() => open({ kind: 'work', page: r.work })}>{r.name}</a></td>
                  <td className="c-artist"><a onClick={() => open({ kind: 'composer', name: r.composer })}>{composerName({ name: r.composer_name, zh: r.composer_zh })}</a></td>
                  <td>{r.file ? r.label || r.file : <span className="muted">{t('wholeWork')}</span>}</td>
                  <td className="c-act cl-act">
                    <a className="mini" href={r.url} target="_blank" rel="noreferrer" title={t('openOnImslp')}>↗</a>
                    <button className="mini rm" title={t('removeScore')} onClick={async () => { await api.unsaveScore(r.id); load() }}><I.Close size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  )
}
