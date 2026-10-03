'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ── Menu latéral ──────────────────────────────────────────────

const NAV = [
  ['/', 'Tableau de bord'],
  ['/ebooks', 'E-books'],
  ['/orders', 'Commandes'],
  ['/users', 'Utilisateurs'],
  ['/stats', 'Statistiques'],
  ['/settings', 'Paramètres'],
  ['/audit', 'Journal'],
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          Folio<span>.</span> <span style={{ fontSize: 13, color: '#a9abb8', fontFamily: 'var(--sans)' }}>admin</span>
        </div>
        <nav className="nav" aria-label="Administration">
          {NAV.map(([href, label]) => {
            const active = href === '/' ? path === '/' : path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="side-foot">
          <button className="btn btn-ghost" style={{ color: '#fff', borderColor: '#3a3c4d' }} onClick={logout} disabled={busy}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="main" id="contenu">
        {children}
      </main>
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="muted" style={{ marginTop: 6 }}>{sub}</div>}
      </div>
      {children && <div className="row">{children}</div>}
    </header>
  );
}

// ── Statuts ───────────────────────────────────────────────────

const STATUS: Record<string, [string, string]> = {
  PAID: ['Confirmée', 'p-ok'],
  PENDING: ['En attente', 'p-wait'],
  FAILED: ['Échouée', 'p-ko'],
  CANCELED: ['Annulée', 'p-ref'],
  REFUNDED: ['Remboursée', 'p-ref'],
  DRAFT: ['Brouillon', 'p-wait'],
  PUBLISHED: ['Publié', 'p-ok'],
  ARCHIVED: ['Archivé', 'p-ref'],
  ACTIVE: ['Actif', 'p-ok'],
  SUSPENDED: ['Suspendu', 'p-ko'],
  DELETED: ['Supprimé', 'p-ref'],
  SUCCEEDED: ['Réussi', 'p-ok'],
  CREATED: ['Créé', 'p-wait'],
};

export const statusLabel = (s: string) => STATUS[s]?.[0] ?? s;

export function Status({ value }: { value: string }) {
  const [label, cls] = STATUS[value] ?? [value, 'p-ref'];
  return <span className={`pill ${cls}`}>{label}</span>;
}

// ── Couverture (générée si aucune image) ──────────────────────

export interface CoverData {
  bg: string;
  fg: string;
  url: string | null;
}

export function Cover({ title, author, cover, w = 40 }: { title: string; author: string; cover: CoverData; w?: number }) {
  const h = Math.round(w * 1.5);
  if (cover.url) {
    return <div className="cover" role="img" aria-label={`Couverture : ${title}`} style={{ width: w, height: h, backgroundImage: `url(${cover.url})` }} />;
  }
  const s = w / 132;
  return (
    <div className="cover" role="img" aria-label={`Couverture : ${title}`} style={{ width: w, height: h, background: cover.bg, color: cover.fg, padding: `${12 * s}px ${12 * s}px ${12 * s}px ${15 * s}px` }}>
      <div style={{ fontSize: Math.max(5, 9 * s), fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', opacity: 0.85 }}>{author}</div>
      <div style={{ width: 55 * s, height: 55 * s, borderRadius: '50%', border: '1.5px solid currentColor', opacity: 0.55, alignSelf: 'flex-end' }} />
      <div className="serif" style={{ fontSize: Math.max(7, 20 * s), lineHeight: 1.02 }}>{title}</div>
    </div>
  );
}

// ── États ─────────────────────────────────────────────────────

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ height: 52 }} />
      ))}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="alert alert-ko" role="alert" style={{ justifyContent: 'space-between' }}>
      <span>{message}</span>
      {retry && (
        <button className="btn btn-ghost" onClick={retry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

// ── Confirmation et notifications ─────────────────────────────

interface ConfirmOpts {
  title: string;
  body?: string;
  confirm: string;
  danger?: boolean;
}

const UiCtx = createContext<{ confirm: (o: ConfirmOpts) => Promise<boolean>; toast: (m: string) => void } | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const confirm = useCallback((o: ConfirmOpts) => {
    setOpts(o);
    return new Promise<boolean>((res) => {
      resolver.current = res;
    });
  }, []);

  useEffect(() => {
    if (opts && dlg.current && !dlg.current.open) dlg.current.showModal();
  }, [opts]);

  const close = (v: boolean) => {
    dlg.current?.close();
    resolver.current?.(v);
    setOpts(null);
  };

  const toast = useCallback((m: string) => {
    clearTimeout(timer.current);
    setMsg(m);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);

  return (
    <UiCtx.Provider value={{ confirm, toast }}>
      {children}
      <dialog ref={dlg} className="modal" onCancel={() => close(false)} aria-labelledby="dlg-title">
        {opts && (
          <div className="grid" style={{ gap: 14 }}>
            <h2 id="dlg-title" className="serif" style={{ fontSize: 28 }}>
              {opts.title}
            </h2>
            {opts.body && <p className="muted" style={{ margin: 0 }}>{opts.body}</p>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-ghost" onClick={() => close(false)} autoFocus>
                Annuler
              </button>
              <button className={opts.danger ? 'btn btn-danger' : 'btn btn-acc'} onClick={() => close(true)}>
                {opts.confirm}
              </button>
            </div>
          </div>
        )}
      </dialog>
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </UiCtx.Provider>
  );
}

export function useUi() {
  const ctx = useContext(UiCtx);
  if (!ctx) throw new Error('UiProvider manquant');
  return ctx;
}
