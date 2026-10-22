import { useEffect, useState } from 'react'
import { api, type User } from './api'
import { t } from './i18n'

export default function Login({ onDone }: { onDone: (u: User) => void }) {
  const invite = new URLSearchParams(location.search).get('invite') || ''
  const [first, setFirst] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>(invite ? 'register' : 'login')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState(invite)
  const [error, setError] = useState('')

  useEffect(() => {
    api.setup().then(s => { if (s.first_user) { setFirst(true); setMode('register') } }).catch(() => {})
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const u = mode === 'login' ? await api.login(name, password) : await api.register(name, password, code)
      history.replaceState(null, '', '/')
      onDone(u)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Yoinker</h1>
      {first && <p className="muted">{t('firstUser')}</p>}
      <input placeholder={t('name')} value={name} onChange={e => setName(e.target.value)} autoComplete="username" />
      <input placeholder={t('password')} type="password" value={password} onChange={e => setPassword(e.target.value)}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
      {mode === 'register' && !first &&
        <input placeholder={t('inviteCode')} value={code} onChange={e => setCode(e.target.value)} />}
      {error && <p className="error">{error}</p>}
      <button type="submit">{mode === 'login' ? t('login') : t('register')}</button>
      {!first &&
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? t('haveInvite') : t('haveAccount')}
        </button>}
    </form>
  )
}
