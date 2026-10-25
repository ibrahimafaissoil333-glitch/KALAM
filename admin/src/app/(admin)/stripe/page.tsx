'use client';

import Link from 'next/link';
import { ErrorState, PageHead, Skeleton, useUi } from '@/components/ui';
import { money, useApi } from '@/lib/api';

interface Config {
  card: { provider: 'stripe' | 'fake'; keyConfigured: boolean; mode: 'live' | 'test' | null; webhookConfigured: boolean; automaticTax: boolean; webhookUrl: string; events: string[] };
  paypal: { configured: boolean; mode: string; webhookUrl: string };
  mobileMoney: { provider: string };
}
interface Revenue {
  commissionPercent: number;
  byCurrency: { currency: string; commissionCents: number; platformSalesCents: number; collected: Record<string, number>; owedToSellersCents: number }[];
  months: { month: string; currency: string; commissionCents: number }[];
}

const METHOD: Record<string, string> = { CARD: 'Carte (Stripe)', PAYPAL: 'PayPal', MOBILE_MONEY: 'Mobile Money' };

function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <span className={`pill ${ok ? 'p-ok' : 'p-wait'}`}>{ok ? 'OK' : 'À faire'}</span>
      <div><strong>{label}</strong>{hint && <div className="muted" style={{ fontSize: 13 }}>{hint}</div>}</div>
    </div>
  );
}

/**
 * Compte Stripe de la plateforme : tous les paiements par carte y arrivent. La commission des vendeurs
 * y reste ; leur part leur est versée depuis la page Versements (virement, PayPal ou Mobile Money).
 */
export default function StripePage() {
  const { toast } = useUi();
  const cfg = useApi<Config>('admin/payments-config');
  const rev = useApi<Revenue>('admin/revenue');
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('Adresse copiée'));

  return (
    <>
      <PageHead title="Stripe" sub="Votre compte Stripe reçoit tous les paiements par carte ; la commission des vendeurs vous revient." />
      {cfg.loading && !cfg.data && <Skeleton rows={4} />}
      {cfg.error && <ErrorState message={cfg.error} retry={cfg.reload} />}
      {cfg.data && (
        <div className="grid g2" style={{ alignItems: 'start', marginBottom: 24 }}>
          <section className="card grid" style={{ gap: 14 }}>
            <h2 style={{ margin: 0 }}>Configuration du paiement par carte</h2>
            {cfg.data.card.provider === 'fake' && <div className="alert alert-warn">Mode simulation : aucun paiement réel n’est encaissé tant que Stripe n’est pas activé.</div>}
            {cfg.data.card.mode === 'test' && <div className="alert alert-warn">Clé de test Stripe : paiements fictifs (cartes de test Stripe).</div>}
            {cfg.data.card.mode === 'live' && <div className="alert alert-ok">Clé réelle : les paiements sont encaissés sur votre compte Stripe.</div>}
            <Check ok={cfg.data.card.keyConfigured} label="Clé secrète Stripe (STRIPE_SECRET_KEY)" hint="Tableau de bord Stripe → Développeurs → Clés API." />
            <Check ok={cfg.data.card.webhookConfigured} label="Secret du webhook (STRIPE_WEBHOOK_SECRET)" hint="Créé à l’ajout du webhook ci-dessous (commence par whsec_)." />
            <Check ok={cfg.data.card.provider === 'stripe'} label="Stripe activé (PAYMENT_PROVIDER=stripe)" />
            <div className="field">
              <label>Adresse du webhook à déclarer dans Stripe</label>
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <input className="input" readOnly value={cfg.data.card.webhookUrl} onFocus={(e) => e.target.select()} />
                <button className="btn btn-ghost" onClick={() => copy(cfg.data!.card.webhookUrl)}>Copier</button>
              </div>
              <span className="hint">Événements : {cfg.data.card.events.join(', ')}</span>
            </div>
            <div className="field">
              <label>Votre compte bancaire (réception de l’argent)</label>
              <span className="hint">Stripe vous reverse les paiements sur le compte bancaire que vous indiquez chez Stripe. Facultatif tant que vous testez ; ajoutez-le ou modifiez-le quand vous voulez.</span>
              <a className="btn btn-ghost" href="https://dashboard.stripe.com/settings/payouts" target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start' }}>Gérer mon compte bancaire dans Stripe</a>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Les clés ne sont jamais enregistrées dans l’application : elles sont placées dans les secrets du serveur (Supabase → Edge Functions → Secrets).
            </p>
          </section>
          <section className="card grid" style={{ gap: 14 }}>
            <h2 style={{ margin: 0 }}>Commission des vendeurs</h2>
            <div className="kpi"><div className="label">Pourcentage prélevé sur chaque vente</div><div className="value">{rev.data?.commissionPercent ?? '…'} %</div></div>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              Calculée sur le prix du livre (hors livraison) et déduite automatiquement des gains du vendeur. Les frais Stripe sont prélevés sur votre compte.
            </p>
            <Link href="/settings" className="btn btn-ghost">Modifier le pourcentage</Link>
            <h2 style={{ margin: '8px 0 0' }}>Autres moyens</h2>
            <Check ok={cfg.data.paypal.configured} label={`PayPal (${cfg.data.paypal.mode})`} hint={cfg.data.paypal.configured ? undefined : 'Clés PayPal non configurées.'} />
            <Check ok={cfg.data.mobileMoney.provider !== 'fake'} label="Mobile Money" hint={cfg.data.mobileMoney.provider === 'fake' ? 'Simulation (contrats opérateurs à signer).' : undefined} />
          </section>
        </div>
      )}

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h2 style={{ padding: '20px 20px 0' }}>Vos revenus</h2>
        {rev.loading && !rev.data && <div style={{ padding: 20 }}><Skeleton rows={2} /></div>}
        {rev.data && rev.data.byCurrency.length === 0 && <p className="muted" style={{ padding: 20 }}>Aucune vente pour le moment.</p>}
        {rev.data && rev.data.byCurrency.length > 0 && (
          <table className="t">
            <thead><tr><th>Devise</th><th className="num">Commissions vendeurs</th><th className="num">Ventes de vos livres</th><th className="num">Total pour vous</th><th>Encaissé par moyen</th><th className="num">Dû aux vendeurs</th></tr></thead>
            <tbody>
              {rev.data.byCurrency.map((r) => (
                <tr key={r.currency}>
                  <td><strong>{r.currency}</strong></td>
                  <td className="num">{money(r.commissionCents, r.currency)}</td>
                  <td className="num">{money(r.platformSalesCents, r.currency)}</td>
                  <td className="num"><strong>{money(r.commissionCents + r.platformSalesCents, r.currency)}</strong></td>
                  <td>{Object.entries(r.collected).map(([m, t]) => `${METHOD[m] ?? m} ${money(t, r.currency)}`).join(' · ') || '—'}</td>
                  <td className="num">{money(r.owedToSellersCents, r.currency)} <Link href="/payouts" style={{ fontSize: 13 }}>verser</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rev.data && rev.data.months.length > 0 && (
          <div style={{ padding: 20 }}>
            <h2>Commissions par mois</h2>
            <div className="row" style={{ gap: 8 }}>
              {rev.data.months.map((m) => <span key={`${m.month}-${m.currency}`} className="chip" style={{ cursor: 'default' }}>{m.month} · {money(m.commissionCents, m.currency)}</span>)}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
