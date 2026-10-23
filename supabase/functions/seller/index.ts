// Espace vendeur : envoi de la couverture ou du fichier du livre, suppression d'une annonce jamais vendue.
// Le reste (création, modification, pause, livraison) passe par les fonctions SQL seller_*.
import { check, handler, HttpError, json, userFromRequest } from '../_shared/http.ts';
import { removeStoredFiles, uploadBookFile } from '../_shared/files.ts';

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const { client } = await userFromRequest(req);

  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await req.formData();
    const ebookId = String(form.get('ebookId') ?? '');
    // Vérifie que l'annonce appartient au vendeur (la fonction SQL répond 404 sinon).
    check(await client.rpc('seller_ebook', { p_id: ebookId }));
    await uploadBookFile(ebookId, String(form.get('kind') ?? ''), form.get('file'));
    return json(check(await client.rpc('seller_ebook', { p_id: ebookId })));
  }

  const body = await req.json().catch(() => ({}));
  if (body.action === 'delete') {
    const files = check(await client.rpc('seller_delete_ebook', { p_id: body.id })) as { path: string; kind: string }[];
    await removeStoredFiles(files);
    return json({ deleted: true });
  }
  throw new HttpError(400, 'Action inconnue.');
}));
