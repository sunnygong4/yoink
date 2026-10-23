import { useEffect, useRef, useState } from 'react'
import { api, report, type Song } from './api'

// /audiotest: each button plays audio one way, inside the tap, and shows what came of it (also into the server's
// log). For finding out what the iPhone home-screen app refuses.

type Result = { name: string; text: string; ok: boolean | null }

export default function AudioTest({ library, onDone }: { library: Song[]; onDone: () => void }) {
  const song = library.find(s => s.status === 'ready')
  const [results, setResults] = useState<Result[]>([])
  const blob = useRef<string | null>(null)
  const [blobReady, setBlobReady] = useState(false)
  const playing = useRef<HTMLAudioElement[]>([])
  const nav = navigator as { audioSession?: { type: string; state?: string }; standalone?: boolean }

  useEffect(() => {
    if (!song) return
    fetch(api.audioUrl(song.id)).then(r => r.blob()).then(b => { blob.current = URL.createObjectURL(b); setBlobReady(true) }).catch(() => {})
  }, [song?.id])

  const add = (r: Result) => {
    setResults(x => [r, ...x])
    report('audiotest', { test: r.name, ok: r.ok, text: r.text })
  }
  const stopAll = () => { playing.current.forEach(a => { a.pause(); a.src = '' }); playing.current = []; document.querySelectorAll('audio').forEach(a => a.pause()) }

  // play an <audio> (made here, inside the tap), then look again a moment later
  function tryAudio(name: string, src: string | null, before?: () => void) {
    if (!src) { add({ name, text: 'no source', ok: false }); return }
    stopAll()
    try { before?.() } catch (e) { add({ name, text: `before: ${(e as Error).message}`, ok: false }); return }
    const a = new Audio()
    a.src = src
    playing.current.push(a)
    const t0 = Date.now()
    a.play().then(
      () => setTimeout(() => add({ name, text: `play ok · after 1.5 s: t=${a.currentTime.toFixed(1)} paused=${a.paused} session=${nav.audioSession?.type ?? '-'}/${nav.audioSession?.state ?? '-'}`, ok: a.currentTime > 0.3 && !a.paused }), 1500),
      (e: Error) => add({ name, text: `${e.name}: ${e.message} (${Date.now() - t0} ms) session=${nav.audioSession?.type ?? '-'}/${nav.audioSession?.state ?? '-'}`, ok: false }),
    )
  }

  function beep() {
    try {
      const ctx = new AudioContext()
      const o = ctx.createOscillator()
      o.frequency.value = 660
      o.connect(ctx.destination)
      o.start(); o.stop(ctx.currentTime + 0.3)
      setTimeout(() => add({ name: 'Web Audio beep', text: `state=${ctx.state}`, ok: ctx.state === 'running' }), 400)
    } catch (e) { add({ name: 'Web Audio beep', text: (e as Error).message, ok: false }) }
  }

  async function dropWorker() {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
    await Promise.all(regs.map(r => r.unregister()))
    add({ name: 'Service worker', text: `removed ${regs.length}; reload the app (close it fully, open again) and test again`, ok: null })
  }

  const server = song ? api.audioUrl(song.id) : null
  const standalone = nav.standalone === true || matchMedia('(display-mode: standalone)').matches
  const tests: [string, () => void][] = [
    ['1 · stream from server', () => tryAudio('1 stream', server)],
    ['2 · downloaded copy (blob)', () => tryAudio('2 blob', blob.current)],
    ['3 · stream, session "playback"', () => tryAudio('3 stream+playback', server, () => { if (nav.audioSession) nav.audioSession.type = 'playback' })],
    ['4 · stream, session "auto"', () => tryAudio('4 stream+auto', server, () => { if (nav.audioSession) nav.audioSession.type = 'auto' })],
    ['5 · blob, session "auto"', () => tryAudio('5 blob+auto', blob.current, () => { if (nav.audioSession) nav.audioSession.type = 'auto' })],
    ['6 · Web Audio beep', beep],
    ['7 · remove the service worker', dropWorker],
  ]

  return (
    <div className="audiotest">
      <h1>Audio test</h1>
      <p>{standalone ? 'Home-screen app' : 'Browser tab'} · service worker: {navigator.serviceWorker?.controller ? 'on' : 'off'} ·
        audio session: {nav.audioSession ? `${nav.audioSession.type}` : 'none'} · song: {song ? song.title : 'none ready'} · blob: {blobReady ? 'ready' : '…'}</p>
      <div className="at-buttons">
        {tests.map(([label, f]) => <button key={label} onClick={f}>{label}</button>)}
        <button onClick={stopAll}>■ stop</button>
        <button onClick={onDone}>← back</button>
      </div>
      <ol className="at-results">
        {results.map((r, i) => <li key={i} className={r.ok === true ? 'ok' : r.ok === false ? 'bad' : ''}><b>{r.name}</b> {r.text}</li>)}
      </ol>
    </div>
  )
}
