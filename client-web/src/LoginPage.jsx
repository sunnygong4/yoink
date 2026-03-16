import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login as apiLogin, register as apiRegister } from './api';
import { useAuth } from './auth';

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (isLogin) {
        const data = await apiLogin(username, password);
        login(data.access_token);
      } else {
        await apiRegister({ username, password, email });
        const data = await apiLogin(username, password);
        login(data.access_token);
      }
      navigate('/');
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.detail || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_35%),linear-gradient(180deg,_#120f0b_0%,_#09090b_100%)] text-stone-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-10 lg:flex-row lg:items-center lg:gap-20">
        <section className="max-w-xl">
          <p className="mb-4 text-xs uppercase tracking-[0.4em] text-amber-200/70">Remote media control</p>
          <h1 className="text-4xl font-black leading-tight text-stone-50 md:text-6xl">
            Queue, stream, and share your media from any browser.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-stone-300">
            Yoinker keeps the heavy download and transcoding work on your server, lets your phone or laptop track
            progress, and turns finished files into a private streaming library with shareable playlist pages.
          </p>
        </section>

        <section className="w-full max-w-md rounded-[2rem] border border-stone-800 bg-stone-950/80 p-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Account</p>
              <h2 className="mt-2 text-3xl font-bold text-stone-50">{isLogin ? 'Sign In' : 'Create Account'}</h2>
            </div>
            <div className="rounded-full border border-amber-300/30 px-3 py-1 text-xs text-amber-200">
              {isLogin ? 'Login' : 'Register'}
            </div>
          </div>

          {error ? (
            <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm text-stone-300">Username</span>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
                required
              />
            </label>

            {!isLogin ? (
              <label className="block">
                <span className="mb-2 block text-sm text-stone-300">Email (optional)</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm text-stone-300">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100 outline-none transition focus:border-amber-300"
                required
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-amber-300 px-4 py-3 font-semibold text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
            >
              {submitting ? 'Working...' : isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setError('');
              setIsLogin((value) => !value);
            }}
            className="mt-6 text-sm text-amber-200 transition hover:text-amber-100"
          >
            {isLogin ? 'Need an account? Register instead.' : 'Already have an account? Sign in.'}
          </button>
        </section>
      </div>
    </div>
  );
}
