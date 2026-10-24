import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from './i18n'

// A first-run tutorial: a card beside the part of the page it's about (lit up, the rest dimmed), step by step.
// The page underneath still works, so a step can ask for something to be done ("add a song") and tick when it is.
// Skippable at any step; the ? button in the sidebar plays it again.

export type TourStep = {
  title: string
  body: string
  target?: string          // a CSS selector: what to light up (none, or not on screen: the card sits in the middle)
  enter?: () => void       // on arriving at the step (open a page, a window)
  leave?: () => void
  task?: string            // something to try; ticked when done() turns true
  done?: () => boolean
  action?: { label: string; run: () => void }   // a button on the card ("open it")
}

const PAD = 6

export default function Tour({ steps, onClose }: { steps: TourStep[]; onClose: (finished: boolean) => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [, tick] = useState(0)
  const card = useRef<HTMLDivElement>(null)
  const [cardSize, setCardSize] = useState({ w: 340, h: 200 })
  const step = steps[i]

  // arriving at / leaving a step
  useEffect(() => {
    step.enter?.()
    return () => step.leave?.()
  }, [i])

  // where the step's target is: looked for again and again (pages load, windows open, the window resizes)
  useEffect(() => {
    const find = () => {
      // "a, b": the first of them that's on screen (the Import window when it's open, else its button)
      let r: DOMRect | null = null
      for (const sel of (step.target ?? '').split(',').map(x => x.trim()).filter(Boolean)) {
        const box = document.querySelector<HTMLElement>(sel)?.getBoundingClientRect()
        if (box && box.width > 0 && box.height > 0) { r = box; break }
      }
      setRect(r)
      tick(n => n + 1)   // (and the task's tick)
    }
    find()
    const timer = setInterval(find, 400)
    return () => clearInterval(timer)
  }, [i])
  useLayoutEffect(() => {
    const el = card.current
    // (only when it changed: a new object every time would render again and again)
    if (el && (el.offsetWidth !== cardSize.w || el.offsetHeight !== cardSize.h)) setCardSize({ w: el.offsetWidth, h: el.offsetHeight })
  })

  const last = i === steps.length - 1
  const done = step.done?.() ?? false
  const next = () => (last ? onClose(true) : setI(i + 1))

  // the card: beside the target where there's room (right, below, left, above), else in the middle
  const vw = innerWidth, vh = innerHeight
  let pos: React.CSSProperties = { left: (vw - cardSize.w) / 2, top: Math.max(16, (vh - cardSize.h) / 2) }
  if (rect) {
    const fits = (x: number, y: number) => x >= 8 && y >= 8 && x + cardSize.w <= vw - 8 && y + cardSize.h <= vh - 8
    const clampY = (y: number) => Math.max(8, Math.min(y, vh - cardSize.h - 8))
    const clampX = (x: number) => Math.max(8, Math.min(x, vw - cardSize.w - 8))
    const options = [
      { left: rect.right + 16, top: clampY(rect.top) },
      { left: clampX(rect.left), top: rect.bottom + 14 },
      { left: rect.left - cardSize.w - 16, top: clampY(rect.top) },
      { left: clampX(rect.left), top: rect.top - cardSize.h - 14 },
    ]
    const ok = options.find(o => fits(o.left, o.top))
    if (ok) pos = ok
  }

  return (
    <div className="tour" role="dialog" aria-label={t('tourTitle')}>
      {rect
        ? <div className="tour-hole" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
        : <div className="tour-dim" />}
      <div className="tour-card" ref={card} style={pos}>
        <div className="tour-count">{t('tourStep', { i: i + 1, n: steps.length })}</div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        {step.task && <p className={'tour-task' + (done ? ' done' : '')}>{done ? '✓' : '→'} {step.task}</p>}
        {step.action && <button className="tour-action" onClick={step.action.run}>{step.action.label}</button>}
        <div className="tour-buttons">
          <button className="link" onClick={() => onClose(false)}>{t('tourSkip')}</button>
          <span className="grow" />
          {i > 0 && <button onClick={() => setI(i - 1)}>{t('tourBack')}</button>}
          <button className="blue" onClick={next}>{last ? t('tourFinish') : done || !step.task ? t('tourNext') : t('tourLater')}</button>
        </div>
      </div>
    </div>
  )
}
