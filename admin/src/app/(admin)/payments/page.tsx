'use client';

import { useState } from 'react';
import { ErrorState, PageHead, Skeleton, useUi } from '@/components/ui';
import { api, date, useApi } from '@/lib/api';

interface Operator { enabled: boolean; label: string }
interface Country { enabled: boolean; name: string; currency: string; dialCode: string; operators: Record<string, Operator> }
interface MobileMoney { enabled: boolean; payoutsEnabled: boolean; countries: Record<string, Country> }
interface LogEntry { id: number; createdAt: string; before: MobileMoney; after: MobileMoney; actor: { name: string; email: string } | null }

/** Liste lisible des interrupteurs modifiés entre deux états. */
function changes(a: MobileMoney, b: MobileMoney) {
  const out: string[] = [];
  const onOff = (v: boolean) => (v ? 'activé' : 'désactivé');
  if (a.enabled !== b.enabled) out.push(`Mobile Money ${onOff(b.enabled)}`);
  if (a.payoutsEnabled !== b.payoutsEnabled) out.push(`Versements automatiques ${onOff(b.payoutsEnabled)}`);
  for (const [code, c] of Object.entries(b.countries)) {
    const prev = a.countries[code];
    if (!prev) continue;
    if (prev.enabled !== c.enabled) out.push(`${c.name} ${onOff(c.enabled)}`);
    for (const [op, o] of Object.entries(c.operators)) if (prev.operators[op]?.enabled !== o.enabled) out.push(`${o.label} (${c.name}) ${onOff(o.enabled)}`);
  }
  return out;
}

function Toggle({ checked, onChange, label, sub, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string; disabled?: boolean }) {
  return (
    <label className="check" style={{ justifyContent: 'space-between', opacity: disabled ? 0.55 : 1 }}>
      <span>
        <strong>{label}</strong>
        {sub && <span className="muted" style={{ display: 'block', fontSize: 13 }}>{sub}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
    </label>
  );
}

/**
 * Activation du paiement Mobile Money, globalement, par pays et par opérateur.
 * Réglage enregistré en base : effet immédiat, sans redéploiement. Les paiements déjà lancés
 * restent traités. Chaque modification est historisée (qui, quand, avant / après).
 */
export default function PaymentsPage() {
  const { toast } = useUi();
  const { data, error, loading, reload, setData } = useApi<MobileMoney>('admin/mobile-money');
  const log = useApi<LogEntry[]>('admin/mobile-money/log');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (loading && !data) return <Skeleton rows={6} />;
  if (error && !data) return <ErrorState message={error} retry={reload} />;
  if (!data) return null;

  const patch = async (p: Record<string, unknown>, msg: string) => {
    setBusy(true);
    setSaveError(null);
    try {
      setData(await api<MobileMoney>('admin/mobile-money', { method: 'PUT', json: p }));
      toast(msg);
      log.reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Mobile Money" sub="Comores (Huri Money, Mvola) et Madagascar (MVola, Orange Money, Airtel Money). Effet immédiat dans l’application." />
      {saveError && <div className="alert alert-ko" role="alert" style={{ marginBottom: 16 }}>{saveError}</div>}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ gap: 16 }}>
          <section className="card grid" style={{ gap: 6 }}>
            <h2 style={{ margin: 0 }}>Général</h2>
            <Toggle
              checked={data.enabled}
              disabled={busy}
              onChange={(v) => patch({ enabled: v }, v ? 'Mobile Money activé' : 'Mobile Money désactivé')}
              label="Paiement Mobile Money"
              sub={data.enabled ? 'Proposé aux acheteurs dans les pays et opérateurs actifs' : 'Option masquée dans l’application ; les paiements en cours restent traités'}
            />
            <Toggle
              checked={data.payoutsEnabled}
              disabled={busy}
              onChange={(v) => patch({ payoutsEnabled: v }, v ? 'Versements automatiques activés' : 'Versements automatiques suspendus')}
              label="Versements automatiques aux vendeurs"
              sub="Gains envoyés sur le numéro Mobile Money du vendeur"
            />
            <div className="alert alert-warn" style={{ marginTop: 8 }}>Mode simulation tant que MOBILE_MONEY_PROVIDER vaut « fake » : aucun argent réel ne circule.</div>
          </section>
          {Object.entries(data.countries).map(([code, c]) => (
            <section key={code} className="card grid" style={{ gap: 6 }}>
              <h2 style={{ margin: 0 }}>{c.name} <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>{c.currency} · {c.dialCode}</span></h2>
              <Toggle checked={c.enabled} disabled={busy} label={`Tout ${c.name}`} onChange={(v) => patch({ countries: { [code]: { enabled: v } } }, `${c.name} ${v ? 'activé' : 'désactivé'}`)} />
              {Object.entries(c.operators).map(([op, o]) => (
                <div key={op} style={{ paddingLeft: 20 }}>
                  <Toggle
                    checked={o.enabled}
                    disabled={busy || !c.enabled}
                    label={o.label}
                    onChange={(v) => patch({ countries: { [code]: { operators: { [op]: { enabled: v } } } } }, `${o.label} ${v ? 'activé' : 'désactivé'}`)}
                  />
                </div>
              ))}
            </section>
          ))}
        </div>
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <h2 style={{ padding: '20px 20px 0' }}>Historique des modifications</h2>
          {log.data && log.data.length === 0 && <p className="muted" style={{ padding: 20 }}>Aucune modification pour le moment.</p>}
          {log.data && log.data.length > 0 && (
            <table className="t">
              <thead><tr><th>Quand</th><th>Qui</th><th>Changement</th></tr></thead>
              <tbody>
                {log.data.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{date(l.createdAt, true)}</td>
                    <td>{l.actor ? <>{l.actor.name}<div className="muted" style={{ fontSize: 13 }}>{l.actor.email}</div></> : '—'}</td>
                    <td>{changes(l.before, l.after).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
