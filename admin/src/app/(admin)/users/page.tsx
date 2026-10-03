'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, ErrorState, PageHead, Skeleton, Status } from '@/components/ui';
import { date, useApi } from '@/lib/api';

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: 'CUSTOMER' | 'ADMIN';
  status: string;
  createdAt: string;
  paidOrders: number;
  ebooks: number;
}

const FILTERS = [
  ['', 'Tous'],
  ['ACTIVE', 'Actifs'],
  ['SUSPENDED', 'Suspendus'],
  ['DELETED', 'Supprimés'],
] as const;

export default function UsersPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams({ ...(status && { status }), ...(debounced && { q: debounced }) }).toString();
  const { data, error, loading, reload } = useApi<UserRow[]>(`admin/users${qs ? `?${qs}` : ''}`);

  return (
    <>
      <PageHead title="Utilisateurs" sub="Demandes RGPD : ouvrez la fiche du compte pour exporter ou anonymiser" />
      <div className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="q" className="sr-only">Rechercher un utilisateur</label>
        <input id="q" className="input search" type="search" placeholder="Nom ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row" role="group" aria-label="Filtrer par statut">
          {FILTERS.map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={status === v} onClick={() => setStatus(v)}>{l}</button>
          ))}
        </div>
      </div>
      {error && <ErrorState message={error} retry={reload} />}
      {loading && !data && <Skeleton />}
      {data && data.length === 0 && <Empty title="Aucun utilisateur" />}
      {data && data.length > 0 && (
        <table className="t">
          <thead>
            <tr><th>Utilisateur</th><th>Rôle</th><th>Statut</th><th className="num">Commandes payées</th><th className="num">E-books</th><th>Inscrit le</th></tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="click" onClick={() => router.push(`/users/${u.id}`)}>
                <td>
                  <Link href={`/users/${u.id}`} style={{ fontWeight: 700, color: 'var(--ink)' }}>{u.name}</Link>
                  <div className="muted" style={{ fontSize: 13 }}>{u.email ?? '—'}</div>
                </td>
                <td>{u.role === 'ADMIN' ? 'Administrateur' : 'Client'}</td>
                <td><Status value={u.status} /></td>
                <td className="num">{u.paidOrders}</td>
                <td className="num">{u.ebooks}</td>
                <td>{date(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
