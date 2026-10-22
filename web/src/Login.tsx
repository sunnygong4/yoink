import { useEffect, useState } from 'react'
import { api, type User } from './api'

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
      {first && <p className="muted">还没有人注册：第一个账号就是管理员，不需要邀请码。</p>}
      <input placeholder="名字" value={name} onChange={e => setName(e.target.value)} autoComplete="username" />
      <input placeholder="密码" type="password" value={password} onChange={e => setPassword(e.target.value)}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
      {mode === 'register' && !first &&
        <input placeholder="邀请码" value={code} onChange={e => setCode(e.target.value)} />}
      {error && <p className="error">{error}</p>}
      <button type="submit">{mode === 'login' ? '登录' : '注册'}</button>
      {!first &&
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '有邀请码？注册' : '已有账号？登录'}
        </button>}
    </form>
  )
}
