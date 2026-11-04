import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { useAuth } from '../state/authStore';
import { inputClass, primaryButton } from '../ui/Modal';

/** Every route needs an account: shows sign-in / sign-up until the user is signed in. */
export function AuthGate() {
  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const check = useAuth((s) => s.check);

  useEffect(() => {
    if (status === 'loading') void check();
  }, [status, check]);

  if (status === 'loading') {
    return <div role="status" className="flex h-full items-center justify-center text-fg-muted">Connecting…</div>;
  }
  if (status === 'offline') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-base font-semibold">Server unavailable</h1>
        <p className="max-w-md text-fg-muted">{error}</p>
        <button type="button" className={primaryButton} onClick={() => useAuth.setState({ status: 'loading' })}>
          Try again
        </button>
      </div>
    );
  }
  if (status === 'signed-out') return <SignIn notice={error} />;
  return <Outlet />;
}

function SignIn({ notice }: { notice: string | null }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login, signup } = useAuth.getState();

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await signup(name, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-app p-4">
      <form onSubmit={submit} aria-label={mode === 'login' ? 'Sign in' : 'Create account'} className="w-full max-w-sm space-y-3 rounded-lg border border-edge bg-sidebar p-6 shadow-2xl">
        <div>
          <p className="text-2xs font-semibold tracking-wide text-accent uppercase">Canvas Studio</p>
          <h1 className="mt-1 text-lg font-semibold">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
        </div>
        {notice && mode === 'login' && <p className="rounded bg-hover px-2 py-1.5 text-fg-muted">{notice}</p>}
        {mode === 'signup' && (
          <label className="block space-y-1 text-fg-muted">
            <span>Name</span>
            <input required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
        )}
        <label className="block space-y-1 text-fg-muted">
          <span>Email</span>
          <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1 text-fg-muted">
          <span>Password</span>
          <input
            required
            type="password"
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {mode === 'signup' && <span className="text-2xs text-fg-subtle">At least 8 characters.</span>}
        </label>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="text-center text-fg-muted">
          {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
          <button type="button" className="text-accent hover:underline" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  );
}
