'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, date, money, useApi } from '@/lib/api';
import type { EbookDetail } from '@/lib/types';
import { Cover, ErrorState, PageHead, Skeleton, Status, useUi } from './ui';

interface Form {
  title: string;
  author: string;
  category: string;
  description: string;
  price: string;
  currency: string;
  format: string;
  pages: string;
  downloadAllowed: boolean;
  previewBlocks: string;
  featured: boolean;
  coverBg: string;
  coverFg: string;
  coverTint: string;
}

const EMPTY: Form = {
  title: '', author: '', category: '', description: '', price: '', currency: 'EUR', format: '', pages: '',
  downloadAllowed: false, previewBlocks: '12', featured: false, coverBg: '#14151F', coverFg: '#D7F25C', coverTint: '#ECEBE6',
};

function toForm(e: EbookDetail): Form {
  return {
    title: e.title, author: e.author, category: e.category?.name ?? '', description: e.description,
    price: e.priceCents === null ? '' : (e.priceCents / 100).toFixed(2).replace('.', ','),
    currency: e.currency, format: e.format ?? '', pages: e.pages?.toString() ?? '',
    downloadAllowed: e.downloadAllowed, previewBlocks: String(e.previewBlocks), featured: e.featured,
    coverBg: e.cover.bg, coverFg: e.cover.fg, coverTint: e.cover.tint,
  };
}

/** Prix saisi en euros (« 12,99 ») → centimes. Vide = prix à définir. */
function parsePrice(v: string): number | null | 'invalid' {
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return 'invalid';
  return Math.round(Number(s) * 100);
}

export function EbookEditor({ id }: { id?: string }) {
  const router = useRouter();
  const { confirm, toast } = useUi();
  const { data, error, loading, reload, setData } = useApi<EbookDetail>(id ? `admin/ebooks/${id}` : null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setForm(toForm(data));
      setDirty(false);
    }
  }, [data]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const validate = () => {
    const e: typeof errors = {};
    if (!form.title.trim()) e.title = 'Le titre est obligatoire.';
    if (!form.author.trim()) e.author = "L'auteur est obligatoire.";
    if (parsePrice(form.price) === 'invalid') e.price = 'Format attendu : 12,99';
    if (form.pages && !/^\d+$/.test(form.pages)) e.pages = 'Nombre entier attendu.';
    if (!/^\d+$/.test(form.previewBlocks)) e.previewBlocks = 'Nombre entier attendu.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const payload = () => ({
    title: form.title.trim(),
    author: form.author.trim(),
    category: form.category.trim(),
    description: form.description,
    priceCents: parsePrice(form.price) as number | null,
    currency: form.currency.toUpperCase(),
    format: form.format.trim() || undefined,
    pages: form.pages ? Number(form.pages) : null,
    downloadAllowed: form.downloadAllowed,
    previewBlocks: Number(form.previewBlocks),
    featured: form.featured,
    coverBg: form.coverBg,
    coverFg: form.coverFg,
    coverTint: form.coverTint,
  });

  const save = async (ev?: FormEvent) => {
    ev?.preventDefault();
    setActionError(null);
    if (!validate()) return false;
    setSaving(true);
    try {
      if (id) {
        setData(await api<EbookDetail>(`admin/ebooks/${id}`, { method: 'PATCH', json: payload() }));
        toast('Brouillon enregistré');
      } else {
        const created = await api<EbookDetail>('admin/ebooks', { method: 'POST', json: payload() });
        setDirty(false);
        toast('E-book créé');
        router.replace(`/ebooks/${created.id}`);
      }
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Enregistrement impossible.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const action = async (path: string, ok: string, opts?: Parameters<typeof confirm>[0]) => {
    if (opts && !(await confirm(opts))) return;
    if (dirty && !(await save())) return;
    setActionError(null);
    setSaving(true);
    try {
      setData(await api<EbookDetail>(`admin/ebooks/${id}/${path}`, { method: 'POST' }));
      toast(ok);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: 'cover' | 'main', file: File | undefined) => {
    if (!file || !id) return;
    setActionError(null);
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setData(await api<EbookDetail>(`admin/ebooks/${id}/files/${kind}`, { method: 'POST', body: fd }));
      toast(kind === 'cover' ? 'Couverture envoyée' : 'Fichier envoyé et contenu extrait');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Envoi impossible.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Supprimer définitivement ?', body: 'Ce brouillon et ses fichiers seront effacés. Cette action est irréversible.', confirm: 'Supprimer', danger: true }))) return;
    try {
      await api(`admin/ebooks/${id}`, { method: 'DELETE' });
      setDirty(false);
      toast('E-book supprimé');
      router.replace('/ebooks');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Suppression impossible.');
    }
  };

  if (id && loading && !data) return <Skeleton rows={8} />;
  if (id && error && !data) return <ErrorState message={error} retry={reload} />;

  const priceCents = parsePrice(form.price);
  const preview = { bg: form.coverBg, fg: form.coverFg, url: data?.cover.url ?? null };
  const fileOf = (k: string) => data?.files.find((f) => f.kind === k);
  const field = (k: keyof Form, label: string, input: React.ReactNode, hint?: string) => (
    <div className="field">
      <label htmlFor={k}>{label}</label>
      {input}
      {errors[k] ? <span className="hint" style={{ color: 'var(--ko-text)' }} id={`${k}-err`}>{errors[k]}</span> : hint && <span className="hint">{hint}</span>}
    </div>
  );
  const text = (k: keyof Form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={k} className="input" value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${k}-err` : undefined} {...props} />
  );

  return (
    <form onSubmit={save} noValidate>
      <PageHead
        title={id ? form.title || 'E-book' : 'Nouvel e-book'}
        sub={data ? <span className="row"><Status value={data.status} /> {data.sales} vente(s) · modifié le {date(data.updatedAt, true)}</span> : 'Enregistré comme brouillon'}
      >
        <button type="submit" className="btn btn-ghost" disabled={saving}>
          Enregistrer le brouillon
        </button>
        {data && data.status !== 'PUBLISHED' && (
          <button type="button" className="btn btn-acc" disabled={saving} onClick={() => action('publish', 'E-book publié', { title: 'Publier cet e-book ?', body: 'Il sera visible et achetable dans le catalogue.', confirm: 'Publier' })}>
            Publier
          </button>
        )}
        {data?.status === 'PUBLISHED' && (
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => action('unpublish', 'E-book dépublié', { title: 'Dépublier ?', body: 'Il disparaîtra du catalogue. Les clients qui l’ont acheté pourront toujours le lire.', confirm: 'Dépublier' })}>
            Dépublier
          </button>
        )}
      </PageHead>

      {actionError && <div className="alert alert-ko" role="alert" style={{ marginBottom: 16 }}>{actionError}</div>}
      {data && data.publishable.length > 0 && data.status !== 'PUBLISHED' && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          Avant de publier : {data.publishable.join(' · ')}
        </div>
      )}

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ gap: 16 }}>
          <section className="card grid" style={{ gap: 16 }}>
            <h2 style={{ margin: 0 }}>Informations</h2>
            {field('title', 'Titre', text('title', { required: true }))}
            {field('author', 'Auteur', text('author', { required: true }))}
            {field('category', 'Catégorie', text('category', { list: 'cats' }), 'Créée automatiquement si elle n’existe pas')}
            {field('description', 'Description', <textarea id="description" className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />, 'Sujet, promesse, public visé')}
            <div className="grid" style={{ gridTemplateColumns: '1fr 120px', gap: 12 }}>
              {field('price', 'Prix TTC', text('price', { inputMode: 'decimal', placeholder: 'À définir' }), priceCents !== null && priceCents !== 'invalid' ? `Affiché : ${money(priceCents, form.currency)}` : 'Vide = prix à définir (non publiable)')}
              {field('currency', 'Devise', text('currency', { maxLength: 3 }))}
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {field('format', 'Format', text('format', { placeholder: 'EPUB' }))}
              {field('pages', 'Pages', text('pages', { inputMode: 'numeric' }))}
            </div>
          </section>

          <section className="card grid" style={{ gap: 12 }}>
            <h2 style={{ margin: 0 }}>Accès</h2>
            <label className="check">
              <input type="checkbox" checked={form.downloadAllowed} onChange={(e) => set('downloadAllowed', e.target.checked)} />
              Autoriser le téléchargement du fichier original
            </label>
            {field('previewBlocks', 'Taille de l’extrait gratuit (paragraphes)', text('previewBlocks', { inputMode: 'numeric', style: { maxWidth: 140 } }), '0 = pas d’extrait')}
            <label className="check">
              <input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} />
              Mettre en avant dans « Sélection du moment »
            </label>
          </section>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <section className="card grid" style={{ gap: 14 }}>
            <h2 style={{ margin: 0 }}>Aperçu de la fiche</h2>
            <div style={{ background: form.coverTint, borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'center' }}>
              <Cover title={form.title || 'Titre'} author={form.author || 'Auteur'} cover={preview} w={132} />
            </div>
            <div>
              {form.category && <span className="pill p-ok" style={{ background: 'var(--indigo-soft)', color: 'var(--indigo-text)' }}>{form.category}</span>}
              <div className="serif" style={{ fontSize: 26, lineHeight: 1.05, marginTop: 8 }}>{form.title || 'Titre'}</div>
              <div className="muted">par {form.author || 'Auteur'}</div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>{priceCents === null || priceCents === 'invalid' ? '[Prix à définir]' : money(priceCents, form.currency)}</div>
            </div>
            {!data?.cover.url && (
              <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {(['coverBg', 'coverFg', 'coverTint'] as const).map((k, i) => (
                  <div className="field" key={k}>
                    <label htmlFor={k} style={{ fontSize: 12 }}>{['Fond', 'Texte', 'Teinte fiche'][i]}</label>
                    <input id={k} type="color" value={form[k]} onChange={(e) => set(k, e.target.value.toUpperCase())} style={{ width: '100%', height: 40, border: 0, background: 'none' }} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card grid" style={{ gap: 14 }}>
            <h2 style={{ margin: 0 }}>Fichiers</h2>
            {!id && <p className="muted" style={{ margin: 0 }}>Enregistrez le brouillon pour envoyer les fichiers.</p>}
            {id && (
              <>
                <div className="field">
                  <label htmlFor="cover-file">Couverture (ratio 2:3, JPEG, PNG ou WebP)</label>
                  <input id="cover-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={(e) => upload('cover', e.target.files?.[0])} />
                  <span className="hint">{fileOf('COVER') ? `Actuelle : ${fileOf('COVER')!.originalName}` : 'Sans image : couverture générée avec les couleurs ci-dessus'}</span>
                </div>
                <div className="field">
                  <label htmlFor="main-file">Fichier de l’e-book (EPUB recommandé, ou PDF)</label>
                  <input id="main-file" type="file" accept=".epub,application/epub+zip,application/pdf" disabled={saving} onChange={(e) => upload('main', e.target.files?.[0])} />
                  <span className="hint">
                    {fileOf('MAIN') ? `${fileOf('MAIN')!.originalName} · ${(fileOf('MAIN')!.sizeBytes / 1024).toFixed(0)} Ko` : 'Aucun fichier'}
                    {' · stockage privé'}
                    {fileOf('CONTENT') ? ' · lisible dans l’app' : ''}
                  </span>
                </div>
              </>
            )}
          </section>

          {data && (
            <section className="card grid" style={{ gap: 10 }}>
              <h2 style={{ margin: 0 }}>Zone sensible</h2>
              {data.status !== 'ARCHIVED' && (
                <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => action('archive', 'E-book archivé', { title: 'Archiver cet e-book ?', body: 'Il sera retiré du catalogue et de la sélection. Les acheteurs gardent leur accès.', confirm: 'Archiver' })}>
                  Archiver
                </button>
              )}
              {data.status === 'DRAFT' && data.sales === 0 && (
                <button type="button" className="btn btn-danger" onClick={remove}>
                  Supprimer définitivement
                </button>
              )}
            </section>
          )}
        </div>
      </div>
      <CategoriesList />
    </form>
  );
}

function CategoriesList() {
  const { data } = useApi<{ name: string }[]>('catalog/categories');
  return (
    <datalist id="cats">
      {data?.map((c) => <option key={c.name} value={c.name} />)}
    </datalist>
  );
}
