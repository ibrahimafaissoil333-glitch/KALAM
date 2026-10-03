'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, ErrorState, PageHead, Skeleton, Status, statusLabel } from '@/components/ui';
import { date, money, useApi } from '@/lib/api';
import type { Order } from '@/lib/types';

const STATUSES = ['', 'PAID', 'PENDING', 'FAILED', 'REFUNDED', 'CANCELED'];

export default function OrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const filters = new URLSearchParams({ ...(status && { status }), ...(debounced && { q: debounced }) });
  const { data, error, loading, reload } = useApi<{ items: Order[]; total: number; page: number; pageSize: number; counts: Record<string, number> }>(
    `admin/orders?${filters}&page=${page}`,
  );
  const all = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHead title="Commandes" sub="Aucune donnée bancaire n’est stockée ni affichée">
        <a className="btn btn-ghost" href={`/api/v1/admin/orders/export.csv?${filters}`} download>
          Exporter en CSV
        </a>
      </PageHead>
      <div className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="q" className="sr-only">Rechercher une commande</label>
        <input id="q" className="input search" type="search" placeholder="Référence ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row" role="group" aria-label="Filtrer par statut">
          {STATUSES.map((s) => (
            <button key={s} className="chip" aria-pressed={status === s} onClick={() => { setStatus(s); setPage(1); }}>
              {s ? statusLabel(s) : 'Toutes'} <span className="n">{s ? (data?.counts[s] ?? 0) : all}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorState message={error} retry={reload} />}
      {loading && !data && <Skeleton />}
      {data && data.items.length === 0 && <Empty title="Aucune commande" />}
      {data && data.items.length > 0 && (
        <>
          <table className="t">
            <thead>
              <tr>
                <th>Référence</th>
                <th>Client</th>
                <th>Articles</th>
                <th className="num">Montant</th>
                <th>Statut</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id} className="click" onClick={() => router.push(`/orders/${o.id}`)}>
                  <td><Link href={`/orders/${o.id}`}>{o.reference}</Link></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{o.user.name}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{o.user.email ?? '—'}</div>
                  </td>
                  <td>{o.items.map((i) => i.title).join(', ')}</td>
                  <td className="num">{money(o.totalCents, o.currency)}</td>
                  <td><Status value={o.status} /></td>
                  <td>{date(o.createdAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <nav className="row" style={{ justifyContent: 'center', marginTop: 16 }} aria-label="Pagination">
              <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</button>
              <span className="muted">Page {page} sur {pages}</span>
              <button className="btn btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
