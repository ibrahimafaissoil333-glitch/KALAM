'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { ErrorState, PageHead, Skeleton, Status, useUi } from '@/components/ui';
import { api, date, money, useApi } from '@/lib/api';

interface UserDetail {
  id: string;
  name: string;
  email: string | null;
  role: 'CUSTOMER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  createdAt: string;
  marketingConsent: boolean;
  deletedAt: string | null;
  orders: { id: string; reference: string; status: string; totalCents: number; currency: string; createdAt: string }[];
  entitlements: { grantedAt: string; ebook: { id: string; title: string } }[];
  devices: { id: string; label: string; platform: string; lastSeenAt: string }[];
}

export default function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { confirm, toast } = useUi();
  const { data: u, error, loading, reload, setData } = useApi<UserDetail>(`admin/users/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !u) return <Skeleton rows={6} />;
  if (error && !u) return <ErrorState message={error} retry={reload} />;
  if (!u) return null;

  const run = async (fn: () => Promise<UserDetail | void>, ok: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (res) setData(res);
      toast(ok);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'ACTIVE' | 'SUSPENDED') => {
    const suspend = status === 'SUSPENDED';
    if (!(await confirm({ title: suspend ? 'Suspendre ce compte ?' : 'Réactiver ce compte ?', body: suspend ? 'Le client sera déconnecté de tous ses appareils et ne pourra plus se connecter.' : undefined, confirm: suspend ? 'Suspendre' : 'Réactiver', danger: suspend }))) return;
    run(() => api<UserDetail>(`admin/users/${id}/status`, { method: 'PATCH', json: { status } }), suspend ? 'Compte suspendu' : 'Compte réactivé');
  };

  const exportData = () =>
    run(async () => {
      const data = await api(`admin/users/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `export-rgpd-${id}.json` });
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'Export téléchargé');

  const anonymize = async () => {
    if (!(await confirm({ title: 'Anonymiser ce compte ?', body: 'Nom, e-mail, appareils, progression et accès seront effacés. Les commandes sont conservées pour la comptabilité. Cette action est irréversible.', confirm: 'Anonymiser', danger: true }))) return;
    run(() => api<UserDetail>(`admin/users/${id}/anonymize`, { method: 'POST' }), 'Compte anonymisé');
  };

  return (
    <>
      <PageHead title={u.name} sub={<span className="row"><Status value={u.status} /> {u.email ?? 'e-mail effacé'} · inscrit le {date(u.createdAt)}</span>}>
        {u.status === 'ACTIVE' && u.role !== 'ADMIN' && <button className="btn btn-ghost" disabled={busy} onClick={() => setStatus('SUSPENDED')}>Suspendre</button>}
        {u.status === 'SUSPENDED' && <button className="btn btn-ghost" disabled={busy} onClick={() => setStatus('ACTIVE')}>Réactiver</button>}
      </PageHead>
      {actionError && <div className="alert alert-ko" role="alert" style={{ marginBottom: 16 }}>{actionError}</div>}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ gap: 16 }}>
          <section className="card" style={{ padding: 0 }}>
            <h2 style={{ padding: '16px 20px 0' }}>Commandes</h2>
            {u.orders.length === 0 ? <p className="muted" style={{ padding: '0 20px 8px' }}>Aucune commande.</p> : (
              <table className="t" style={{ border: 0 }}>
                <tbody>
                  {u.orders.map((o) => (
                    <tr key={o.id}><td><Link href={`/orders/${o.id}`}>{o.reference}</Link></td><td>{date(o.createdAt)}</td><td className="num">{money(o.totalCents, o.currency)}</td><td><Status value={o.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="card">
            <h2>Bibliothèque</h2>
            {u.entitlements.length === 0 ? <p className="muted" style={{ margin: 0 }}>Aucun e-book.</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>{u.entitlements.map((e) => <li key={e.ebook.id}>{e.ebook.title} <span className="muted">· depuis le {date(e.grantedAt)}</span></li>)}</ul>
            )}
          </section>
        </div>
        <div className="grid" style={{ gap: 16 }}>
          <section className="card">
            <h2>Appareils</h2>
            {u.devices.length === 0 ? <p className="muted" style={{ margin: 0 }}>Aucun appareil.</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>{u.devices.map((d) => <li key={d.id}>{d.label} ({d.platform}) <span className="muted">· vu le {date(d.lastSeenAt)}</span></li>)}</ul>
            )}
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Nouveautés par e-mail : {u.marketingConsent ? 'accepté' : 'refusé'}</p>
          </section>
          {u.status !== 'DELETED' && (
            <section className="card grid" style={{ gap: 10 }}>
              <h2 style={{ margin: 0 }}>Demandes RGPD</h2>
              <button className="btn btn-ghost" disabled={busy} onClick={exportData}>Exporter les données (JSON)</button>
              {u.role !== 'ADMIN' && <button className="btn btn-danger" disabled={busy} onClick={anonymize}>Anonymiser le compte</button>}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
