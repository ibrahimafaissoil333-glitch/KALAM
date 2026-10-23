// Actions d'administration qui sortent de la base : remboursement (prestataire), envoi de fichiers,
// suppression avec nettoyage du stockage, anonymisation RGPD (compte d'authentification).
import { check, handler, HttpError, json, serviceClient, userFromRequest } from '../_shared/http.ts';
import { EpubError, parseEpub } from '../_shared/epub.ts';
import { provider } from '../_shared/payments.ts';

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const { client, user } = await userFromRequest(req);
  if (user.role !== 'ADMIN') throw new HttpError(403, 'Accès refusé.');
  const db = serviceClient();
  const audit = (action: string, type: string, id: string, meta?: unknown) =>
    db.from('audit_logs').insert({ actor_id: user.id, action, target_type: type, target_id: id, meta: meta ?? null });

  // Envoi de fichier : multipart/form-data, champs action=upload, ebookId, kind (cover|main), file.
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await req.formData();
    const ebookId = String(form.get('ebookId') ?? '');
    const kind = String(form.get('kind') ?? '').toUpperCase();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Aucun fichier reçu.');
    if (kind !== 'COVER' && kind !== 'MAIN') throw new HttpError(400, 'Type de fichier attendu : cover ou main.');
    const ebook = check(await db.from('ebooks').select('id, format, pages').eq('id', ebookId).single());
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stamp = Date.now();

    const replace = async (k: 'COVER' | 'MAIN' | 'CONTENT', bucket: string, body: Uint8Array, mime: string, ext: string, original = '') => {
      const { data: old } = await db.from('ebook_files').select('id, storage_path').eq('ebook_id', ebookId).eq('kind', k);
      const path = `${ebookId}/${k.toLowerCase()}-${stamp}.${ext}`;
      check(await db.storage.from(bucket).upload(path, body, { contentType: mime, upsert: false }));
      check(await db.from('ebook_files').insert({ ebook_id: ebookId, kind: k, storage_path: path, mime_type: mime, size_bytes: body.length, original_name: original }));
      for (const o of old ?? []) {
        await db.from('ebook_files').delete().eq('id', o.id);
        await db.storage.from(bucket).remove([o.storage_path]);
      }
    };

    if (kind === 'COVER') {
      if (!COVER_TYPES.includes(file.type)) throw new HttpError(400, 'Couverture : JPEG, PNG ou WebP attendu.');
      await replace('COVER', 'covers', bytes, file.type, file.type.split('/')[1], file.name);
    } else {
      const name = file.name.toLowerCase();
      const isEpub = name.endsWith('.epub') || file.type === 'application/epub+zip';
      const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
      if (!isEpub && !isPdf) throw new HttpError(400, 'Fichier principal : EPUB ou PDF attendu.');
      if (isEpub) {
        let content;
        try {
          content = await parseEpub(bytes);
        } catch (err) {
          throw new HttpError(400, err instanceof EpubError ? err.message : 'EPUB illisible.');
        }
        await replace('MAIN', 'ebooks', bytes, 'application/epub+zip', 'epub', file.name);
        await replace('CONTENT', 'ebooks', new TextEncoder().encode(JSON.stringify(content)), 'application/json', 'json');
        await db.from('ebooks').update({ format: ebook.format ?? 'EPUB', pages: ebook.pages ?? Math.max(1, Math.round(content.wordCount / 250)) }).eq('id', ebookId);
      } else {
        await replace('MAIN', 'ebooks', bytes, 'application/pdf', 'pdf', file.name);
        await db.from('ebooks').update({ format: ebook.format ?? 'PDF' }).eq('id', ebookId);
      }
    }
    await audit(`ebook.upload.${kind.toLowerCase()}`, 'ebook', ebookId, { name: file.name, size: bytes.length });
    // Relu avec le client de l'admin : la fonction SQL vérifie à nouveau le rôle.
    return json(check(await client.rpc('admin_ebook', { p_id: ebookId })));
  }

  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case 'refund': {
      const order = check(await db.from('orders').select('id, status, payments(provider_payment_id, status)').eq('id', body.orderId).single());
      if (order.status !== 'PAID') throw new HttpError(409, 'Seule une commande confirmée peut être remboursée.');
      const paid = order.payments.find((p: { status: string }) => p.status === 'SUCCEEDED');
      if (paid?.provider_payment_id) await provider().refund(paid.provider_payment_id);
      check(await db.rpc('svc_mark_refunded', { p_order: order.id, p_actor: user.id }));
      return json(check(await client.rpc('admin_order', { p_id: order.id })));
    }
    case 'delete-ebook': {
      const files = check(await client.rpc('admin_delete_ebook', { p_id: body.id })) as { path: string; kind: string }[];
      for (const f of files) await db.storage.from(f.kind === 'COVER' ? 'covers' : 'ebooks').remove([f.path]);
      return json({ deleted: true });
    }
    case 'anonymize': {
      if (body.userId === user.id) throw new HttpError(400, 'Vous ne pouvez pas anonymiser votre propre compte ici.');
      await anonymize(db, body.userId);
      await audit('user.anonymize', 'user', body.userId);
      return json(check(await client.rpc('admin_user', { p_id: body.userId })));
    }
    default:
      throw new HttpError(400, 'Action inconnue.');
  }
}));

/** Anonymise le profil et rend le compte d'authentification inutilisable (e-mail effacé, banni). */
export async function anonymize(db: ReturnType<typeof serviceClient>, userId: string) {
  check(await db.rpc('anonymize_user', { p_id: userId }));
  const { error } = await db.auth.admin.updateUserById(userId, {
    email: `supprime-${userId}@invalid.folio`,
    user_metadata: {},
    ban_duration: '876000h',
  });
  if (error) throw new HttpError(500, 'Anonymisation incomplète.');
  await db.auth.admin.signOut(userId).catch(() => undefined);
}
