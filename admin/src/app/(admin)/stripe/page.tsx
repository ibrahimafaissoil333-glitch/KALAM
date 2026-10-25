'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ErrorState, PageHead, Skeleton, useUi } from '@/components/ui';
import { api, money, useApi } from '@/lib/api';

interface Config {
  card: { provider: 'stripe' | 'fake'; source: 'env' | 'admin' | null; keyHint: string | null; keyConfigured: boolean; mode: 'live' | 'test' | null; webhookConfigured: boolean; automaticTax: boolean; webhookUrl: string; events: string[] };
  paypal: { configured: boolean; source: 'env' | 'admin' | null; mode: string; keyHint: string | null; webhookConfigured: boolean; webhookUrl: string };
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
            <Check ok={cfg.data.card.provider === 'stripe'} label="Paiement par carte actif" hint={cfg.data.card.keyHint ? `Clé enregistrée ${cfg.data.card.keyHint}${cfg.data.card.source === 'env' ? ' (secrets du serveur)' : ''}` : 'Saisissez vos clés ci-dessous quand vous êtes prêt.'} />
            <KeysForm provider="stripe" configured={cfg.data.card.source === 'admin'} locked={cfg.data.card.source === 'env'} onDone={cfg.reload} />
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
              Les clés sont vérifiées auprès de Stripe puis enregistrées chiffrées ; elles ne sont jamais réaffichées ni envoyées à l’application mobile.
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
            <Check ok={cfg.data.paypal.configured} label={`PayPal (${cfg.data.paypal.mode === 'live' ? 'réel' : 'test'})`} hint={cfg.data.paypal.keyHint ? `Client ID ${cfg.data.paypal.keyHint}` : 'Clés PayPal non configurées.'} />
            <KeysForm provider="paypal" configured={cfg.data.paypal.source === 'admin'} locked={cfg.data.paypal.source === 'env'} onDone={cfg.reload} webhookUrl={cfg.data.paypal.webhookUrl} />
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

/** Saisie des clés par l'administrateur, quand il le souhaite : vérifiées, chiffrées, jamais réaffichées. */
function KeysForm({ provider, configured, locked, onDone, webhookUrl }: { provider: 'stripe' | 'paypal'; configured: boolean; locked: boolean; onDone: () => void; webhookUrl?: string }) {
  const { toast, confirm } = useUi();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ secretKey: '', webhookSecret: '', clientId: '', clientSecret: '', webhookId: '', mode: 'sandbox' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  if (locked) return <p className="muted" style={{ margin: 0, fontSize: 13 }}>Clés définies dans les secrets du serveur : elles priment sur la saisie ici.</p>;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('admin/payment-keys', { method: 'POST', json: provider === 'stripe' ? { provider, secretKey: f.secretKey, webhookSecret: f.webhookSecret } : { provider, clientId: f.clientId, clientSecret: f.clientSecret, webhookId: f.webhookId, mode: f.mode } });
      setF({ secretKey: '', webhookSecret: '', clientId: '', clientSecret: '', webhookId: '', mode: 'sandbox' });
      setOpen(false);
      toast(provider === 'stripe' ? 'Clés Stripe enregistrées' : 'Identifiants PayPal enregistrés');
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (!(await confirm({ title: provider === 'stripe' ? 'Retirer les clés Stripe ?' : 'Retirer les identifiants PayPal ?', body: provider === 'stripe' ? 'Le paiement par carte repassera en simulation.' : 'PayPal ne sera plus proposé.', confirm: 'Retirer', danger: true }))) return;
    await api('admin/payment-keys', { method: 'DELETE', json: { provider } });
    toast('Clés retirées');
    onDone();
  };

  if (!open) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-acc" onClick={() => setOpen(true)}>{configured ? 'Remplacer les clés' : provider === 'stripe' ? 'Saisir mes clés Stripe' : 'Saisir mes identifiants PayPal'}</button>
        {configured && <button className="btn btn-danger" onClick={clear}>Retirer</button>}
      </div>
    );
  }
  return (
    <form onSubmit={save} className="grid" style={{ gap: 10, padding: 14, border: '1px solid var(--border)', borderRadius: 14 }} autoComplete="off">
      {provider === 'stripe' ? (
        <>
          <div className="field"><label htmlFor="sk">Clé secrète (sk_test_… ou sk_live_…)</label><input id="sk" className="input" type="password" value={f.secretKey} onChange={set('secretKey')} required /></div>
          <div className="field"><label htmlFor="wh">Secret du webhook (whsec_…)</label><input id="wh" className="input" type="password" value={f.webhookSecret} onChange={set('webhookSecret')} required /></div>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="pm">Mode</label>
            <select id="pm" className="input" value={f.mode} onChange={set('mode')}><option value="sandbox">Test (sandbox)</option><option value="live">Réel</option></select>
          </div>
          <div className="field"><label htmlFor="ci">Client ID</label><input id="ci" className="input" type="password" value={f.clientId} onChange={set('clientId')} required /></div>
          <div className="field"><label htmlFor="cs">Secret</label><input id="cs" className="input" type="password" value={f.clientSecret} onChange={set('clientSecret')} required /></div>
          <div className="field">
            <label htmlFor="wi">Webhook ID (facultatif)</label><input id="wi" className="input" value={f.webhookId} onChange={set('webhookId')} />
            {webhookUrl && <span className="hint">Adresse du webhook à déclarer chez PayPal : {webhookUrl}</span>}
          </div>
        </>
      )}
      {err && <div className="alert alert-ko" role="alert">{err}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-acc" disabled={busy}>{busy ? 'Vérification…' : 'Vérifier et enregistrer'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </form>
  );
}
