'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Cover, Empty, ErrorState, PageHead, Skeleton, Status } from '@/components/ui';
import { date, money, useApi } from '@/lib/api';
import type { Ebook } from '@/lib/types';

const FILTERS = [
  ['', 'Tous'],
  ['DRAFT', 'Brouillons'],
  ['PUBLISHED', 'Publiés'],
  ['ARCHIVED', 'Archivés'],
] as const;

export default function EbooksPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams({ ...(status && { status }), ...(debounced && { q: debounced }) }).toString();
  const { data, error, loading, reload } = useApi<Ebook[]>(`admin/ebooks${qs ? `?${qs}` : ''}`);

  return (
    <>
      <PageHead title="E-books" sub={data ? `${data.length} e-book${data.length > 1 ? 's' : ''}` : ' '}>
        <Link href="/ebooks/new" className="btn btn-acc">
          Nouvel e-book
        </Link>
      </PageHead>
      <div className="row" style={{ marginBottom: 16 }}>
        <label htmlFor="q" className="sr-only">Rechercher</label>
        <input id="q" className="input search" type="search" placeholder="Titre, auteur, catégorie" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row" role="group" aria-label="Filtrer par statut">
          {FILTERS.map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={status === v} onClick={() => setStatus(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorState message={error} retry={reload} />}
      {loading && !data && <Skeleton />}
      {data && data.length === 0 && (
        <Empty title="Aucun e-book">
          <p>Modifiez la recherche ou créez votre premier e-book.</p>
        </Empty>
      )}
      {data && data.length > 0 && (
        <table className="t">
          <thead>
            <tr>
              <th>E-book</th>
              <th>Catégorie</th>
              <th className="num">Prix</th>
              <th>Statut</th>
              <th className="num">Ventes</th>
              <th>Mis à jour</th>
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id} className="click" onClick={() => router.push(`/ebooks/${e.id}`)}>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <Cover title={e.title} author={e.author} cover={e.cover} />
                    <div>
                      <Link href={`/ebooks/${e.id}`} style={{ fontWeight: 700, color: 'var(--ink)' }}>
                        {e.title}
                      </Link>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {e.author}
                        {e.featured && ' · En sélection'}
                      </div>
                    </div>
                  </div>
                </td>
                <td>{e.category?.name ?? <span className="muted">—</span>}</td>
                <td className="num">{e.priceCents === null ? <span className="pill p-wait">À définir</span> : money(e.priceCents, e.currency)}</td>
                <td>
                  <Status value={e.status} />
                </td>
                <td className="num">{e.sales}</td>
                <td>{date(e.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
