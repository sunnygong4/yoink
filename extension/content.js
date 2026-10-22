// The bridge between the Yoinker website and this extension: the site posts { source: 'yoinker-page', ... }
// messages, we pass them to the background worker and post its answers (and sync progress) back.
(() => {
  const SAY = msg => window.postMessage({ source: 'yoinker-ipod', ...msg }, location.origin)

  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.source !== 'yoinker-page') return
    const { reqId, ...msg } = e.data
    chrome.runtime.sendMessage({ from: 'page', origin: location.origin, ...msg }, reply => {
      SAY({ type: 'reply', reqId, reply: reply ?? { error: chrome.runtime.lastError?.message || 'no answer' } })
    })
  })

  // pushed by the background worker while it syncs
  chrome.runtime.onMessage.addListener(msg => { if (msg?.to === 'page') SAY(msg) })

  // let the page know an iPod is plugged in (now, and whenever it asks again)
  const hello = () => SAY({ type: 'present', version: chrome.runtime.getManifest().version })
  hello()
  window.addEventListener('DOMContentLoaded', hello)
})()
