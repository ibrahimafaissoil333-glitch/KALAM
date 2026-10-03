'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { date, money, useApi } from '@/lib/api';
import type { Stats } from '@/lib/types';
import { Empty, ErrorState, Skeleton, Status } from './ui';

export const PERIODS = [
  ['7d', '7 jours'],
  ['30d', '30 jours'],
  ['90d', '90 jours'],
  ['12m', '12 mois'],
] as const;

export function PeriodPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="row" role="group" aria-label="Période">
      {PERIODS.map(([v, l]) => (
        <button key={v} className="chip" aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function WeeklyBars({ weekly, currency }: { weekly: Stats['weekly']; currency: string }) {
  if (!weekly.length) return <p className="muted">Aucune vente sur la période.</p>;
  const max = Math.max(...weekly.map((w) => w.revenueCents), 1);
  const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  return (
    <figure style={{ margin: 0 }}>
      <div className="bars" role="img" aria-label={`Ventes par semaine : ${weekly.map((w) => `semaine du ${fmt.format(new Date(w.week))}, ${money(w.revenueCents, currency)}`).join(' ; ')}`}>
        {weekly.map((w) => (
          <div key={w.week} className="bar" style={{ height: `${(w.revenueCents / max) * 100}%` }} title={`${money(w.revenueCents, currency)} · ${w.orders} commande(s)`} />
        ))}
      </div>
      <div className="bars-x" aria-hidden="true">
        {weekly.map((w) => (
          <span key={w.week}>{fmt.format(new Date(w.week))}</span>
        ))}
      </div>
    </figure>
  );
}

export function Kpis({ s }: { s: Stats }) {
  const items = [
    ["Chiffre d'affaires", money(s.revenueCents, s.currency)],
    ['Commandes payées', String(s.paidOrders)],
    ['Panier moyen', money(s.averageOrderCents, s.currency)],
    ["Taux d'échec de paiement", `${Math.round(s.failureRate * 100)} %`],
  ];
  return (
    <div className="grid g4">
      {items.map(([l, v]) => (
        <div key={l} className="card kpi">
          <div className="label">{l}</div>
          <div className="value">{v}</div>
        </div>
      ))}
    </div>
  );
}

export function StatsView({ dashboard = false }: { dashboard?: boolean }) {
  const [period, setPeriod] = useState('30d');
  const { data: s, error, loading, reload } = useApi<Stats>(`admin/stats?period=${period}`);
  const router = useRouter();

  return (
    <div className="grid" style={{ gap: 20 }}>
      <PeriodPicker value={period} onChange={setPeriod} />
      {error && <ErrorState message={error} retry={reload} />}
      {loading && !s && <Skeleton rows={4} />}
      {s && (
        <>
          <Kpis s={s} />
          <div className="grid g2">
            <section className="card">
              <h2>Ventes par semaine</h2>
              <WeeklyBars weekly={s.weekly} currency={s.currency} />
            </section>
            <section className="card">
              <h2>E-books les plus vendus</h2>
              {s.topEbooks.every((t) => t.sales === 0 && t.views === 0) ? (
                <p className="muted">Pas encore de données.</p>
              ) : (
                <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 10 }}>
                  {s.topEbooks.map((t) => (
                    <li key={t.id}>
                      <Link href={`/ebooks/${t.id}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>
                        {t.title}
                      </Link>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {t.sales} vente(s) · {money(t.revenueCents, s.currency)} · {t.views} consultation(s)
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          {dashboard ? (
            <section className="card" style={{ padding: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', padding: '16px 20px 4px' }}>
                <h2 style={{ margin: 0 }}>Dernières commandes</h2>
                <Link href="/orders">Toutes les commandes</Link>
              </div>
              {s.recentOrders.length === 0 ? (
                <Empty title="Aucune commande pour le moment" />
              ) : (
                <table className="t" style={{ border: 0 }}>
                  <thead>
                    <tr>
                      <th>Référence</th>
                      <th>Client</th>
                      <th>Date</th>
                      <th className="num">Montant</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recentOrders.map((o) => (
                      <tr key={o.id} className="click" onClick={() => router.push(`/orders/${o.id}`)}>
                        <td>
                          <Link href={`/orders/${o.id}`}>{o.reference}</Link>
                        </td>
                        <td>{o.user.email ?? o.user.name}</td>
                        <td>{date(o.createdAt, true)}</td>
                        <td className="num">{money(o.totalCents, o.currency)}</td>
                        <td>
                          <Status value={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ) : (
            <section className="card">
              <h2>Activité</h2>
              <div className="grid g4">
                <div className="kpi"><div className="label">Consultations de fiches</div><div className="value">{s.views}</div></div>
                <div className="kpi"><div className="label">Clients actifs</div><div className="value">{s.activeCustomers}</div></div>
                <div className="kpi"><div className="label">Commandes remboursées</div><div className="value">{s.ordersByStatus.REFUNDED ?? 0}</div></div>
                <div className="kpi"><div className="label">Commandes annulées</div><div className="value">{s.ordersByStatus.CANCELED ?? 0}</div></div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
