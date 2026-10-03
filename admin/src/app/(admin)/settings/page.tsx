'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ErrorState, PageHead, Skeleton, useUi } from '@/components/ui';
import { api, useApi } from '@/lib/api';

type Mode = 'external' | 'web_only';
interface Settings {
  appName: string;
  checkoutMode: { ios: Mode; android: Mode };
  webCheckoutUrl: string | null;
  maxDevices: number | null;
  maxDownloadsPerBook: number | null;
  supportEmail: string | null;
  termsUrl: string | null;
  salesTermsUrl: string | null;
  privacyUrl: string | null;
  legalNoticeUrl: string | null;
}

const MODES: [Mode, string][] = [
  ['external', 'Paiement externe depuis l’app (page sécurisée du prestataire)'],
  ['web_only', 'App de lecture : achat sur le site uniquement'],
];

const LINKS: [keyof Settings, string][] = [
  ['termsUrl', 'Conditions générales d’utilisation'],
  ['salesTermsUrl', 'Conditions générales de vente'],
  ['privacyUrl', 'Politique de confidentialité'],
  ['legalNoticeUrl', 'Mentions légales'],
];

export default function SettingsPage() {
  const { toast } = useUi();
  const { data, error, loading, reload, setData } = useApi<Settings>('admin/settings');
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => setS(data), [data]);

  if (loading && !s) return <Skeleton rows={6} />;
  if (error && !s) return <ErrorState message={error} retry={reload} />;
  if (!s) return null;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const str = (v: string) => (v.trim() ? v.trim() : null);
  const num = (v: string) => (v.trim() ? Number(v) : null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaveError(null);
    try {
      setData(await api<Settings>('admin/settings', { method: 'PUT', json: s }));
      toast('Paramètres enregistrés');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save}>
      <PageHead title="Paramètres" sub="Les choix « à définir » du cahier des charges, modifiables sans développement">
        <button className="btn btn-acc" disabled={busy}>Enregistrer</button>
      </PageHead>
      {saveError && <div className="alert alert-ko" role="alert" style={{ marginBottom: 16 }}>{saveError}</div>}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ gap: 16 }}>
          <section className="card grid" style={{ gap: 14 }}>
            <h2 style={{ margin: 0 }}>Modèle de paiement par plateforme</h2>
            <div className="alert alert-warn">À valider selon les règles de l’App Store et de Google Play en vigueur dans chaque pays de publication (voir docs/01-cadrage.md §2).</div>
            {(['ios', 'android'] as const).map((p) => (
              <fieldset key={p} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 4 }}>
                <legend className="label-txt" style={{ marginBottom: 6 }}>{p === 'ios' ? 'iPhone (App Store)' : 'Android (Google Play)'}</legend>
                {MODES.map(([v, l]) => (
                  <label key={v} className="check">
                    <input type="radio" name={`mode-${p}`} checked={s.checkoutMode[p] === v} onChange={() => set('checkoutMode', { ...s.checkoutMode, [p]: v })} />
                    {l}
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="field">
              <label htmlFor="web">Adresse du site d’achat (mode « app de lecture »)</label>
              <input id="web" className="input" type="url" value={s.webCheckoutUrl ?? ''} onChange={(e) => set('webCheckoutUrl', str(e.target.value))} placeholder="https://" />
            </div>
          </section>
          <section className="card grid" style={{ gap: 14 }}>
            <h2 style={{ margin: 0 }}>Limites d’accès</h2>
            <div className="field">
              <label htmlFor="dev">Nombre maximal d’appareils par compte</label>
              <input id="dev" className="input" inputMode="numeric" value={s.maxDevices ?? ''} onChange={(e) => set('maxDevices', num(e.target.value))} placeholder="Illimité" style={{ maxWidth: 200 }} />
            </div>
            <div className="field">
              <label htmlFor="dl">Téléchargements maximum par e-book et par client</label>
              <input id="dl" className="input" inputMode="numeric" value={s.maxDownloadsPerBook ?? ''} onChange={(e) => set('maxDownloadsPerBook', num(e.target.value))} placeholder="Illimité" style={{ maxWidth: 200 }} />
              <span className="hint">Laisser vide pour ne pas limiter.</span>
            </div>
          </section>
        </div>
        <div className="grid" style={{ gap: 16 }}>
          <section className="card grid" style={{ gap: 14 }}>
            <h2 style={{ margin: 0 }}>Application</h2>
            <div className="field">
              <label htmlFor="name">Nom affiché</label>
              <input id="name" className="input" value={s.appName} onChange={(e) => set('appName', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="support">E-mail du support</label>
              <input id="support" className="input" type="email" value={s.supportEmail ?? ''} onChange={(e) => set('supportEmail', str(e.target.value))} />
            </div>
          </section>
          <section className="card grid" style={{ gap: 14 }}>
            <h2 style={{ margin: 0 }}>Documents légaux</h2>
            {LINKS.map(([k, l]) => (
              <div className="field" key={k}>
                <label htmlFor={k}>{l}</label>
                <input id={k} className="input" type="url" value={(s[k] as string | null) ?? ''} onChange={(e) => set(k, str(e.target.value) as never)} placeholder="https://" />
              </div>
            ))}
          </section>
        </div>
      </div>
    </form>
  );
}
