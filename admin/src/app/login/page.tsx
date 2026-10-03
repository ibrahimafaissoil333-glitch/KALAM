'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.includes('@')) return setError('Saisissez une adresse e-mail valide.');
    if (!password) return setError('Saisissez votre mot de passe.');
    setBusy(true);
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setError(b.message ?? 'Connexion impossible.');
    }
    const next = params.get('next');
    window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  };

  return (
    <form onSubmit={submit} className="card grid" style={{ gap: 18, width: '100%', maxWidth: 420, padding: 28 }} noValidate>
      <div className="serif" style={{ fontSize: 36 }}>
        Folio<span style={{ color: 'var(--indigo)' }}>.</span>
      </div>
      <div>
        <h1 className="serif" style={{ fontSize: 30, fontWeight: 400 }}>Administration</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>Accès réservé aux administrateurs.</p>
      </div>
      {error && (
        <div className="alert alert-ko" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Adresse e-mail</label>
        <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">Mot de passe</label>
        <div style={{ position: 'relative' }}>
          <input id="password" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 110 }} />
          <button type="button" className="btn btn-ghost" onClick={() => setShow(!show)} style={{ position: 'absolute', right: 4, top: 0, minHeight: 44, border: 0 }} aria-pressed={show}>
            {show ? 'Masquer' : 'Afficher'}
          </button>
        </div>
      </div>
      <button className="btn btn-acc btn-lg" disabled={busy}>
        {busy ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
