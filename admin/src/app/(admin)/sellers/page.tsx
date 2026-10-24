'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, ErrorState, PageHead, Skeleton, Status } from '@/components/ui';
import { date, money, useApi } from '@/lib/api';

interface SellerRow {
  id: string;
  name: string;
  email: string | null;
  status: string;
  createdAt: string;
  listings: { onSale: number; paused: number; removed: number; total: number };
  sold: number;
  lastSaleAt: string | null;
  totals: { currency: string; grossCents: number; commissionCents: number; netCents: number; availableCents: number }[];
}

/** Tous les utilisateurs qui vendent : annonces, ventes, chiffre et gains. */
export default function SellersPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, loading, reload } = useApi<SellerRow[]>(`admin/sellers${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`);

  return (
    <>
      <PageHead title="Vendeurs" sub="Ventes de chaque vendeur ; ouvrez une fiche pour voir le détail ou retirer une annonce" />
      <div className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="q" className="sr-only">Rechercher un vendeur</label>
        <input id="q" className="input search" type="search" placeholder="Nom ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <ErrorState message={error} retry={reload} />}
      {loading && !data && <Skeleton />}
      {data && data.length === 0 && <Empty title="Aucun vendeur pour le moment" />}
      {data && data.length > 0 && (
        <table className="t">
          <thead>
            <tr><th>Vendeur</th><th>Statut</th><th className="num">En vente</th><th className="num">Retirées</th><th className="num">Vendus</th><th className="num">Ventes (brut)</th><th className="num">Gains nets</th><th>Dernière vente</th></tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} className="click" onClick={() => router.push(`/sellers/${s.id}`)}>
                <td><strong>{s.name}</strong><div className="muted" style={{ fontSize: 13 }}>{s.email ?? '—'}</div></td>
                <td><Status value={s.status} /></td>
                <td className="num">{s.listings.onSale}</td>
                <td className="num">{s.listings.removed}</td>
                <td className="num">{s.sold}</td>
                <td className="num">{s.totals.length ? s.totals.map((t) => money(t.grossCents, t.currency)).join(' · ') : '—'}</td>
                <td className="num">{s.totals.length ? s.totals.map((t) => money(t.netCents, t.currency)).join(' · ') : '—'}</td>
                <td>{date(s.lastSaleAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
