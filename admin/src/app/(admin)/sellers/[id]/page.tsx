'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Cover, ErrorState, PageHead, Skeleton, Status, useUi } from '@/components/ui';
import { api, date, money, useApi } from '@/lib/api';
import type { EbookDetail } from '@/lib/types';

interface Sale {
  orderId: string;
  reference: string;
  date: string;
  status: string;
  title: string;
  kind: 'PHYSICAL' | 'DIGITAL';
  priceCents: number;
  shippingCents: number;
  currency: string;
  paymentMethod: string;
  buyer: { name: string; email: string | null } | null;
  netCents: number | null;
  commissionCents: number | null;
}
interface Seller {
  id: string;
  name: string;
  email: string | null;
  status: string;
  createdAt: string;
  listings: EbookDetail[];
  sales: Sale[];
  payouts: { id: string; method: string; currency: string; amountCents: number; status: string; reference: string | null; paidAt: string | null; createdAt: string }[];
}

const METHOD: Record<string, string> = { CARD: 'Carte', MOBILE_MONEY: 'Mobile Money', PAYPAL: 'PayPal' };

/** Fiche vendeur : annonces (retrait ou remise en vente à tout moment), ventes et versements. */
export default function SellerPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useUi();
  const { data: s, error, loading, reload } = useApi<Seller>(`admin/sellers/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (loading && !s) return <Skeleton rows={6} />;
  if (error && !s) return <ErrorState message={error} retry={reload} />;
  if (!s) return null;

  const moderate = async (e: EbookDetail, action: 'remove' | 'restore') => {
    let reason: string | null = null;
    if (action === 'remove') {
      reason = window.prompt(`Retirer « ${e.title} » de la vente ?\nMotif envoyé au vendeur (facultatif) :`, '');
      if (reason === null) return;
    }
    setBusy(e.id);
    setErr(null);
    try {
      await api(`admin/listings/${e.id}/${action}`, { method: 'POST', json: { reason } });
      toast(action === 'remove' ? 'Annonce retirée, le vendeur est prévenu' : 'Annonce remise en vente');
      await reload();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Action impossible.');
    } finally {
      setBusy(null);
    }
  };

  const totals = s.sales.filter((x) => x.status === 'PAID').reduce<Record<string, { gross: number; net: number; commission: number }>>((acc, x) => {
    const t = (acc[x.currency] ??= { gross: 0, net: 0, commission: 0 });
    t.gross += x.priceCents + x.shippingCents;
    t.net += x.netCents ?? 0;
    t.commission += x.commissionCents ?? 0;
    return acc;
  }, {});

  return (
    <>
      <PageHead title={s.name} sub={<span className="row">{s.email} · <Status value={s.status} /> · inscrit le {date(s.createdAt)} · <Link href={`/users/${s.id}`}>fiche utilisateur</Link></span>} />
      {err && <div className="alert alert-ko" role="alert" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="grid g3" style={{ marginBottom: 24 }}>
        {Object.keys(totals).length === 0 && <div className="card kpi"><div className="label">Ventes</div><div className="value">0</div></div>}
        {Object.entries(totals).map(([cur, t]) => (
          <div key={cur} className="card kpi">
            <div className="label">Ventes en {cur}</div>
            <div className="value">{money(t.gross, cur)}</div>
            <div className="muted" style={{ fontSize: 13 }}>Commission {money(t.commission, cur)} · net vendeur {money(t.net, cur)}</div>
          </div>
        ))}
      </div>

      <section className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <h2 style={{ padding: '20px 20px 0' }}>Annonces ({s.listings.length})</h2>
        {s.listings.length === 0 ? <p className="muted" style={{ padding: 20 }}>Aucune annonce.</p> : (
          <table className="t">
            <thead><tr><th>Livre</th><th>Type</th><th className="num">Prix</th><th>Statut</th><th className="num">Ventes</th><th>Action</th></tr></thead>
            <tbody>
              {s.listings.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                      <Cover title={e.title} author={e.author} cover={e.cover} w={32} />
                      <Link href={`/ebooks/${e.id}`}><strong>{e.title}</strong></Link>
                    </div>
                  </td>
                  <td>{e.kind === 'PHYSICAL' ? `Physique · stock ${e.stock ?? 0}` : 'Numérique'}</td>
                  <td className="num">{money(e.priceCents, e.currency)}</td>
                  <td><Status value={e.status} /></td>
                  <td className="num">{e.sales}</td>
                  <td>
                    {e.status === 'ARCHIVED' ? (
                      <button className="btn btn-ghost" disabled={busy === e.id} onClick={() => moderate(e, 'restore')}>Remettre en vente</button>
                    ) : (
                      <button className="btn btn-danger" disabled={busy === e.id} onClick={() => moderate(e, 'remove')}>Retirer</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <h2 style={{ padding: '20px 20px 0' }}>Ventes ({s.sales.length})</h2>
        {s.sales.length === 0 ? <p className="muted" style={{ padding: 20 }}>Aucune vente.</p> : (
          <table className="t">
            <thead><tr><th>Date</th><th>Commande</th><th>Livre</th><th>Acheteur</th><th>Paiement</th><th className="num">Montant</th><th className="num">Net vendeur</th><th>Statut</th></tr></thead>
            <tbody>
              {s.sales.map((x, i) => (
                <tr key={`${x.orderId}-${i}`}>
                  <td>{date(x.date, true)}</td>
                  <td><Link href={`/orders/${x.orderId}`}>{x.reference}</Link></td>
                  <td>{x.title}<div className="muted" style={{ fontSize: 12 }}>{x.kind === 'PHYSICAL' ? 'Physique' : 'Numérique'}</div></td>
                  <td>{x.buyer?.name ?? '—'}<div className="muted" style={{ fontSize: 12 }}>{x.buyer?.email ?? ''}</div></td>
                  <td>{METHOD[x.paymentMethod] ?? x.paymentMethod}</td>
                  <td className="num">{money(x.priceCents + x.shippingCents, x.currency)}</td>
                  <td className="num">{x.netCents === null ? '—' : money(x.netCents, x.currency)}</td>
                  <td><Status value={x.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h2 style={{ padding: '20px 20px 0' }}>Versements</h2>
        {s.payouts.length === 0 ? <p className="muted" style={{ padding: 20 }}>Aucun versement.</p> : (
          <table className="t">
            <thead><tr><th>Date</th><th>Moyen</th><th className="num">Montant</th><th>Statut</th><th>Référence</th></tr></thead>
            <tbody>
              {s.payouts.map((p) => (
                <tr key={p.id}>
                  <td>{date(p.paidAt ?? p.createdAt, true)}</td>
                  <td>{p.method === 'BANK' ? 'Virement' : p.method === 'PAYPAL' ? 'PayPal' : 'Mobile Money'}</td>
                  <td className="num">{money(p.amountCents, p.currency)}</td>
                  <td><Status value={p.status} /></td>
                  <td>{p.reference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
