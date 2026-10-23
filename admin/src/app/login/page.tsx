'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    // Seuls les administrateurs entrent ; même message qu'un mauvais mot de passe pour un compte client.
    const admin = !authError && (await supabase.rpc('is_admin')).data === true;
    if (!admin) {
      if (!authError) await supabase.auth.signOut();
      setBusy(false);
      return setError(authError?.status === 429 ? 'Trop de tentatives. Réessayez dans quelques minutes.' : 'E-mail ou mot de passe incorrect.');
    }
    await supabase.rpc('register_device', { p_key: 'admin-web', p_label: 'Administration web', p_platform: 'web' });
    setBusy(false);
    const next = params.get('next');
    window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  };

  return (
    <form onSubmit={submit} className="card grid" style={{ gap: 18, width: '100%', maxWidth: 420, padding: 28 }} noValidate>
      <div className="row" style={{ gap: 14 }}>
        <img src="/logo.png" alt="" width={52} height={58} />
        <span className="serif" style={{ fontSize: 36 }}>Folio</span>
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
