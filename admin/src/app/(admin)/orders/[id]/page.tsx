'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { ErrorState, PageHead, Skeleton, Status, useUi } from '@/components/ui';
import { api, date, money, useApi } from '@/lib/api';
import type { Order } from '@/lib/types';

interface OrderDetail extends Order {
  taxCountry: string | null;
  failedAt: string | null;
  refundedAt: string | null;
  canceledAt: string | null;
  payments: { provider: string; providerSessionId: string; providerPaymentId: string | null; status: string; amountCents: number; currency: string; failureReason: string | null; createdAt: string; updatedAt: string }[];
  events: { id: string; type: string; outcome: string; providerEventId: string; receivedAt: string }[];
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { confirm, toast } = useUi();
  const { data: o, error, loading, reload, setData } = useApi<OrderDetail>(`admin/orders/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !o) return <Skeleton rows={6} />;
  if (error && !o) return <ErrorState message={error} retry={reload} />;
  if (!o) return null;

  const refund = async () => {
    const ok = await confirm({
      title: 'Rembourser cette commande ?',
      body: `Le client sera remboursé de ${money(o.totalCents, o.currency)} et perdra l’accès aux e-books de cette commande. Un e-mail lui sera envoyé.`,
      confirm: 'Rembourser',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    try {
      setData(await api<OrderDetail>(`admin/orders/${id}/refund`, { method: 'POST' }));
      toast('Commande remboursée');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Remboursement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const timeline = [
    ['Créée', o.createdAt],
    ['Payée', o.paidAt],
    ['Échouée', o.failedAt],
    ['Annulée', o.canceledAt],
    ['Remboursée', o.refundedAt],
  ].filter(([, d]) => d) as [string, string][];

  return (
    <>
      <PageHead title={`Commande ${o.reference}`} sub={<span className="row"><Status value={o.status} /> {date(o.createdAt, true)}</span>}>
        {o.status === 'PAID' && (
          <button className="btn btn-danger" onClick={refund} disabled={busy}>
            Rembourser
          </button>
        )}
      </PageHead>
      {actionError && <div className="alert alert-ko" role="alert" style={{ marginBottom: 16 }}>{actionError}</div>}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ gap: 16 }}>
          <section className="card" style={{ padding: 0 }}>
            <table className="t" style={{ border: 0 }}>
              <thead><tr><th>E-book</th><th className="num">Prix</th></tr></thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.ebookId}><td><Link href={`/ebooks/${i.ebookId}`}>{i.title}</Link></td><td className="num">{money(i.priceCents, o.currency)}</td></tr>
                ))}
                {o.taxCents !== null && <tr><td className="muted">dont TVA {o.taxCountry ? `(${o.taxCountry})` : ''}</td><td className="num">{money(o.taxCents, o.currency)}</td></tr>}
                <tr><td style={{ fontWeight: 700 }}>Total</td><td className="num" style={{ fontWeight: 700 }}>{money(o.totalCents, o.currency)}</td></tr>
              </tbody>
            </table>
          </section>
          <section className="card">
            <h2>Paiement</h2>
            {o.payments.map((p) => (
              <dl key={p.providerSessionId} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '6px 12px', margin: 0, fontSize: 14 }}>
                <dt className="muted">Prestataire</dt><dd style={{ margin: 0 }}>{p.provider}</dd>
                <dt className="muted">Statut</dt><dd style={{ margin: 0 }}><Status value={p.status} /></dd>
                <dt className="muted">Session</dt><dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{p.providerSessionId}</dd>
                <dt className="muted">Identifiant de paiement</dt><dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{p.providerPaymentId ?? '—'}</dd>
                {p.failureReason && (<><dt className="muted">Motif d’échec</dt><dd style={{ margin: 0 }}>{p.failureReason}</dd></>)}
              </dl>
            ))}
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Les données de carte restent chez le prestataire.</p>
          </section>
          <section className="card">
            <h2>Événements reçus du prestataire</h2>
            {o.events.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Aucun webhook reçu{o.status === 'PENDING' ? ' : paiement en vérification.' : '.'}</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
                {o.events.map((e) => <li key={e.id}>{date(e.receivedAt, true)} · {e.type} · <span className="muted">{e.outcome}</span></li>)}
              </ul>
            )}
          </section>
        </div>
        <div className="grid" style={{ gap: 16 }}>
          <section className="card">
            <h2>Client</h2>
            <div style={{ fontWeight: 600 }}>{o.user.name}</div>
            <div className="muted">{o.user.email ?? 'Compte supprimé'}</div>
            {o.user.id && <Link href={`/users/${o.user.id}`} style={{ display: 'inline-block', marginTop: 8 }}>Voir le compte</Link>}
          </section>
          <section className="card">
            <h2>Historique</h2>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
              {timeline.map(([l, d]) => <li key={l}><b>{l}</b> · {date(d, true)}</li>)}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
