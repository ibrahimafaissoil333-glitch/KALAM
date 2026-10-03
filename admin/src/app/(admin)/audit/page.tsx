'use client';

import { useState } from 'react';
import { Empty, ErrorState, PageHead, Skeleton } from '@/components/ui';
import { date, useApi } from '@/lib/api';

interface Log {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  actor: { name: string; email: string | null } | null;
}

const LABELS: Record<string, string> = {
  'admin.login': 'Connexion administrateur',
  'ebook.create': 'E-book créé',
  'ebook.price': 'Prix modifié',
  'ebook.publish': 'E-book publié',
  'ebook.unpublish': 'E-book dépublié',
  'ebook.archive': 'E-book archivé',
  'ebook.delete': 'E-book supprimé',
  'ebook.upload.cover': 'Couverture envoyée',
  'ebook.upload.main': 'Fichier envoyé',
  'order.refund': 'Commande remboursée',
  'orders.export': 'Export CSV des commandes',
  'user.suspend': 'Compte suspendu',
  'user.reactivate': 'Compte réactivé',
  'user.export': 'Export RGPD',
  'user.anonymize': 'Compte anonymisé',
  'user.delete': 'Compte supprimé par son titulaire',
  'settings.update': 'Paramètres modifiés',
};

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Log[]>(`admin/audit-logs?page=${page}`);
  return (
    <>
      <PageHead title="Journal" sub="Actions sensibles, conservées pour la traçabilité" />
      {error && <ErrorState message={error} retry={reload} />}
      {loading && !data && <Skeleton />}
      {data && data.length === 0 && <Empty title="Aucune entrée" />}
      {data && data.length > 0 && (
        <table className="t">
          <thead><tr><th>Date</th><th>Action</th><th>Auteur</th><th>Détail</th><th>IP</th></tr></thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.id}>
                <td>{date(l.createdAt, true)}</td>
                <td style={{ fontWeight: 600 }}>{LABELS[l.action] ?? l.action}</td>
                <td>{l.actor ? l.actor.email ?? l.actor.name : 'Système'}</td>
                <td className="muted" style={{ fontSize: 13, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.meta ? Object.entries(l.meta).map(([k, v]) => `${k} : ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : l.targetId ?? ''}
                </td>
                <td className="muted" style={{ fontSize: 13 }}>{l.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <nav className="row" style={{ justifyContent: 'center', marginTop: 16 }} aria-label="Pagination">
        <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Plus récent</button>
        <button className="btn btn-ghost" disabled={!data || data.length < 50} onClick={() => setPage(page + 1)}>Plus ancien</button>
      </nav>
    </>
  );
}
