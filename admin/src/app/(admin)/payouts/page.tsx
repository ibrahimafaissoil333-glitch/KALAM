'use client';

import { useState } from 'react';
import { ErrorState, PageHead, Skeleton, Status, useUi } from '@/components/ui';
import { api, date, money, useApi } from '@/lib/api';

interface Account { id: string; kind: 'BANK' | 'MOBILE_MONEY' | 'PAYPAL'; country: string; operator: string | null; holderName: string; bankName: string | null; masked: string }
interface Due { sellerId: string; currency: string; amountCents: number; lines: number; seller: { name: string; email: string }; account: Account | null }
interface Payout { id: string; method: 'BANK' | 'MOBILE_MONEY' | 'PAYPAL'; currency: string; amountCents: number; status: string; reference: string | null; providerRef: string | null; failureReason: string | null; paidAt: string | null; createdAt: string; seller: { name: string; email: string } }

/**
 * Sommes dues aux vendeurs (commission déduite, dettes de remboursement imputées).
 * Mobile Money : versé automatiquement. Banque ou PayPal : l'admin fait le virement (ou l'envoi PayPal),
 * affiche l'IBAN ou l'e-mail PayPal (chaque affichage est journalisé) puis marque le versement comme effectué.
 */
export default function PayoutsPage() {
  const { toast } = useUi();
  const due = useApi<Due[]>('admin/payouts/due');
  const history = useApi<Payout[]>('admin/payouts');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reveal = async (a: Account) => {
    setErr(null);
    try {
      const r = await api<{ value: string }>(`admin/payout-accounts/${a.id}/reveal`, { method: 'POST' });
      setRevealed({ ...revealed, [a.id]: r.value });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Affichage impossible.');
    }
  };

  const markPaid = async (d: Due) => {
    const key = `${d.sellerId}-${d.currency}`;
    if (!confirm(`Confirmer le virement de ${money(d.amountCents, d.currency)} à ${d.seller.name} ?`)) return;
    setBusy(key);
    setErr(null);
    try {
      due.setData(await api<Due[]>('admin/payouts/bank', { method: 'POST', json: { sellerId: d.sellerId, currency: d.currency, reference: refs[key] } }));
      history.reload();
      toast('Versement enregistré');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead title="Versements" sub="Gains des vendeurs à reverser, commission déduite." />
      {err && <div className="alert alert-ko" role="alert" style={{ marginBottom: 16 }}>{err}</div>}
      <section className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <h2 style={{ padding: '20px 20px 0' }}>À verser</h2>
        {due.loading && !due.data && <div style={{ padding: 20 }}><Skeleton rows={3} /></div>}
        {due.error && <div style={{ padding: 20 }}><ErrorState message={due.error} retry={due.reload} /></div>}
        {due.data && due.data.length === 0 && <p className="muted" style={{ padding: 20 }}>Aucune somme en attente.</p>}
        {due.data && due.data.length > 0 && (
          <table className="t">
            <thead><tr><th>Vendeur</th><th className="num">Montant</th><th>Moyen de réception</th><th>Action</th></tr></thead>
            <tbody>
              {due.data.map((d) => {
                const key = `${d.sellerId}-${d.currency}`;
                const a = d.account;
                return (
                  <tr key={key}>
                    <td>{d.seller.name}<div className="muted" style={{ fontSize: 13 }}>{d.seller.email} · {d.lines} vente{d.lines > 1 ? 's' : ''}</div></td>
                    <td className="num"><strong>{money(d.amountCents, d.currency)}</strong></td>
                    <td>
                      {!a ? <span className="pill p-wait">Aucun moyen enregistré</span> : (
                        <>
                          {a.kind === 'BANK' ? `${a.bankName ?? 'Banque'} · ${a.holderName}` : a.kind === 'PAYPAL' ? `PayPal · ${a.holderName}` : `${a.operator} · ${a.holderName}`}
                          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{revealed[a.id] ?? a.masked}</div>
                          {a.kind !== 'MOBILE_MONEY' && !revealed[a.id] && <button className="btn btn-ghost" style={{ minHeight: 32, padding: '0 10px', marginTop: 4 }} onClick={() => reveal(a)}>{a.kind === 'PAYPAL' ? 'Afficher l’e-mail PayPal' : 'Afficher l’IBAN'}</button>}
                        </>
                      )}
                    </td>
                    <td>
                      {a?.kind === 'MOBILE_MONEY' ? <span className="muted" style={{ fontSize: 13 }}>Versement automatique</span> : (
                        <div className="row" style={{ gap: 8 }}>
                          <input className="input" placeholder={a?.kind === 'PAYPAL' ? 'Réf. de l’envoi PayPal' : 'Réf. du virement'} value={refs[key] ?? ''} onChange={(e) => setRefs({ ...refs, [key]: e.target.value })} style={{ maxWidth: 160, minHeight: 40 }} aria-label="Référence du virement" />
                          <button className="btn btn-acc" disabled={!a || busy === key} onClick={() => markPaid(d)}>Marquer comme versé</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h2 style={{ padding: '20px 20px 0' }}>Historique</h2>
        {history.data && history.data.length === 0 && <p className="muted" style={{ padding: 20 }}>Aucun versement.</p>}
        {history.data && history.data.length > 0 && (
          <table className="t">
            <thead><tr><th>Date</th><th>Vendeur</th><th>Moyen</th><th className="num">Montant</th><th>Statut</th><th>Référence</th></tr></thead>
            <tbody>
              {history.data.map((p) => (
                <tr key={p.id}>
                  <td>{date(p.paidAt ?? p.createdAt, true)}</td>
                  <td>{p.seller.name}</td>
                  <td>{p.method === 'BANK' ? 'Virement' : p.method === 'PAYPAL' ? 'PayPal' : 'Mobile Money'}</td>
                  <td className="num">{money(p.amountCents, p.currency)}</td>
                  <td><Status value={p.status} />{p.failureReason && <div className="muted" style={{ fontSize: 12 }}>{p.failureReason}</div>}</td>
                  <td>{p.reference ?? p.providerRef ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
