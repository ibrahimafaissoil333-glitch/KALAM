'use client';

import { useState } from 'react';
import { Cover, ErrorState, PageHead, Skeleton, useUi } from '@/components/ui';
import { api, money, useApi } from '@/lib/api';
import { promoVideoUrl } from '@/lib/supabase';
import type { Ebook } from '@/lib/types';

interface Slide {
  id: string;
  headline: string | null;
  subtitle: string | null;
  videoPath: string | null;
  sort: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  ebook: Ebook & { status: string };
}

const toInput = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 16) : '');
const fromInput = (v: string) => (v ? new Date(v).toISOString() : null);

/**
 * Carrousel publicitaire de l'accueil de l'app : n'importe quel livre publié peut y être mis en avant,
 * avec un titre et un sous-titre facultatifs, une période d'affichage et une vidéo (MP4, 50 Mo max).
 * Sans diapositive active, l'app fait défiler la sélection du moment.
 */
export default function PromosPage() {
  const { toast, confirm } = useUi();
  const { data, error, loading, reload, setData } = useApi<Slide[]>('admin/promos');
  const books = useApi<Ebook[]>('admin/ebooks?status=PUBLISHED');
  const [pick, setPick] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Partial<Slide>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<Slide[] | Slide>, msg: string) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await fn();
      if (Array.isArray(r)) setData(r);
      else await reload();
      toast(msg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setBusy(null);
    }
  };

  const add = () => run('add', () => api<Slide>('admin/promos', { method: 'POST', json: { ebookId: pick } }), 'Livre ajouté au carrousel');
  const save = (s: Slide) => {
    const d = drafts[s.id] ?? {};
    return run(s.id, async () => {
      const r = await api<Slide>(`admin/promos/${s.id}`, { method: 'PATCH', json: d });
      setDrafts(({ [s.id]: _, ...rest }) => rest);
      return r;
    }, 'Diapositive enregistrée');
  };
  const toggle = (s: Slide) => run(s.id, () => api<Slide>(`admin/promos/${s.id}`, { method: 'PATCH', json: { active: !s.active } }), s.active ? 'Diapositive masquée' : 'Diapositive affichée');
  const move = (s: Slide, dir: number) => run(s.id, () => api<Slide[]>(`admin/promos/${s.id}/move`, { method: 'POST', json: { dir } }), 'Ordre modifié');
  const upload = (s: Slide, file: File) => {
    const form = new FormData();
    form.set('file', file);
    return run(s.id, () => api<Slide[]>(`admin/promos/${s.id}/video`, { method: 'POST', body: form }), 'Vidéo ajoutée');
  };
  const removeVideo = (s: Slide) => run(s.id, () => api<Slide[]>(`admin/promos/${s.id}/video`, { method: 'DELETE' }), 'Vidéo retirée');
  const remove = async (s: Slide) => {
    if (!(await confirm({ title: 'Retirer ce livre du carrousel ?', body: s.ebook.title, confirm: 'Retirer', danger: true }))) return;
    run(s.id, () => api<Slide[]>(`admin/promos/${s.id}`, { method: 'DELETE' }), 'Diapositive supprimée');
  };
  const set = (s: Slide, k: keyof Slide, v: unknown) => setDrafts({ ...drafts, [s.id]: { ...drafts[s.id], [k]: v } });
  const val = <K extends keyof Slide>(s: Slide, k: K) => (drafts[s.id]?.[k] !== undefined ? drafts[s.id][k] : s[k]) as Slide[K];

  return (
    <>
      <PageHead title="Carrousel" sub="Livres mis en avant en haut de l’accueil de l’app, avec vidéo facultative.">
        <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Livre à mettre en avant" style={{ minWidth: 260 }}>
          <option value="">Choisir un livre publié…</option>
          {books.data?.map((b) => <option key={b.id} value={b.id}>{b.title} — {b.author}{b.seller ? ` (${b.seller.name})` : ''}</option>)}
        </select>
        <button className="btn btn-acc" disabled={!pick || busy === 'add'} onClick={add}>Ajouter au carrousel</button>
      </PageHead>
      {err && <div className="alert alert-ko" role="alert" style={{ marginBottom: 16 }}>{err}</div>}
      {loading && !data && <Skeleton rows={3} />}
      {error && !data && <ErrorState message={error} retry={reload} />}
      {data && data.length === 0 && (
        <div className="card empty">
          <h3>Aucune diapositive</h3>
          <p>L’app fait défiler la sélection du moment. Ajoutez un livre pour choisir vous-même ce qui est mis en avant.</p>
        </div>
      )}
      <div className="grid" style={{ gap: 16 }}>
        {data?.map((s, i) => {
          const video = promoVideoUrl(s.videoPath);
          const dirty = !!drafts[s.id];
          return (
            <section key={s.id} className="card" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, opacity: s.active ? 1 : 0.6 }}>
              <div style={{ background: 'var(--ink)', borderRadius: 16, overflow: 'hidden', position: 'relative', height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {video ? <video src={video} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Cover title={s.ebook.title} author={s.ebook.author} cover={s.ebook.cover} w={80} />}
              </div>
              <div className="grid" style={{ gap: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{i + 1}. {s.ebook.title}</strong>
                    <span className="muted"> · {s.ebook.author} · {money(s.ebook.priceCents, s.ebook.currency)}</span>
                    {s.ebook.status !== 'PUBLISHED' && <span className="pill p-wait" style={{ marginLeft: 8 }}>Livre non publié : masqué</span>}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-ghost" style={{ minHeight: 36 }} disabled={i === 0 || !!busy} onClick={() => move(s, -1)} aria-label="Monter">↑</button>
                    <button className="btn btn-ghost" style={{ minHeight: 36 }} disabled={i === data.length - 1 || !!busy} onClick={() => move(s, 1)} aria-label="Descendre">↓</button>
                    <label className="check" style={{ minHeight: 36 }}>
                      <input type="checkbox" role="switch" checked={s.active} disabled={!!busy} onChange={() => toggle(s)} /> Affichée
                    </label>
                  </div>
                </div>
                <div className="grid g2" style={{ gap: 10 }}>
                  <div className="field">
                    <label htmlFor={`h-${s.id}`}>Titre affiché (vide = titre du livre)</label>
                    <input id={`h-${s.id}`} className="input" maxLength={80} value={val(s, 'headline') ?? ''} onChange={(e) => set(s, 'headline', e.target.value)} placeholder={s.ebook.title} />
                  </div>
                  <div className="field">
                    <label htmlFor={`s-${s.id}`}>Sous-titre (vide = auteur et prix)</label>
                    <input id={`s-${s.id}`} className="input" maxLength={140} value={val(s, 'subtitle') ?? ''} onChange={(e) => set(s, 'subtitle', e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`a-${s.id}`}>Début (facultatif)</label>
                    <input id={`a-${s.id}`} className="input" type="datetime-local" value={toInput(val(s, 'startsAt'))} onChange={(e) => set(s, 'startsAt', fromInput(e.target.value))} />
                  </div>
                  <div className="field">
                    <label htmlFor={`b-${s.id}`}>Fin (facultatif)</label>
                    <input id={`b-${s.id}`} className="input" type="datetime-local" value={toInput(val(s, 'endsAt'))} onChange={(e) => set(s, 'endsAt', fromInput(e.target.value))} />
                  </div>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
                      {video ? 'Remplacer la vidéo' : 'Ajouter une vidéo'}
                      <input type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(e) => e.target.files?.[0] && upload(s, e.target.files[0])} />
                    </label>
                    {video && <button className="btn btn-ghost" disabled={!!busy} onClick={() => removeVideo(s)}>Retirer la vidéo</button>}
                    <span className="muted" style={{ fontSize: 13 }}>MP4, MOV ou WebM · 50 Mo max · lue sans le son</span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-danger" disabled={!!busy} onClick={() => remove(s)}>Supprimer</button>
                    <button className="btn btn-acc" disabled={!dirty || busy === s.id} onClick={() => save(s)}>Enregistrer</button>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
