// Actions d'administration qui sortent de la base : remboursement (prestataire), envoi de fichiers,
// suppression avec nettoyage du stockage, anonymisation RGPD, affichage d'un IBAN pour un virement manuel.
import { check, handler, HttpError, json, serviceClient, userFromRequest } from '../_shared/http.ts';
import { decryptSecret } from '../_shared/crypto.ts';
import { removeStoredFiles, uploadBookFile } from '../_shared/files.ts';
import { provider } from '../_shared/payments.ts';

Deno.serve(handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
  const { client, user } = await userFromRequest(req);
  if (user.role !== 'ADMIN') throw new HttpError(403, 'Accès refusé.');
  const db = serviceClient();
  const audit = (action: string, type: string, id: string, meta?: unknown) =>
    db.from('audit_logs').insert({ actor_id: user.id, action, target_type: type, target_id: id, meta: meta ?? null });

  // Envoi de fichier : multipart/form-data, champs ebookId, kind (cover|main), file.
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await req.formData();
    const ebookId = String(form.get('ebookId') ?? '');
    const sent = await uploadBookFile(ebookId, String(form.get('kind') ?? ''), form.get('file'));
    await audit(`ebook.upload.${sent.kind.toLowerCase()}`, 'ebook', ebookId, { name: sent.name, size: sent.size });
    // Relu avec le client de l'admin : la fonction SQL vérifie à nouveau le rôle.
    return json(check(await client.rpc('admin_ebook', { p_id: ebookId })));
  }

  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case 'refund': {
      const order = check(await db.from('orders').select('id, status, payment_method, payments(provider, provider_payment_id, status)').eq('id', body.orderId).single());
      if (order.status !== 'PAID') throw new HttpError(409, 'Seule une commande confirmée peut être remboursée.');
      const paid = order.payments.find((p: { status: string }) => p.status === 'SUCCEEDED');
      // Carte : remboursement chez le prestataire. Mobile Money : renvoi manuel par l'admin (pas d'API de remboursement commune).
      if (order.payment_method === 'CARD' && paid?.provider_payment_id) await provider().refund(paid.provider_payment_id);
      check(await db.rpc('svc_mark_refunded', { p_order: order.id, p_actor: user.id }));
      return json(check(await client.rpc('admin_order', { p_id: order.id })));
    }
    case 'delete-ebook': {
      const files = check(await client.rpc('admin_delete_ebook', { p_id: body.id })) as { path: string; kind: string }[];
      await removeStoredFiles(files);
      return json({ deleted: true });
    }
    case 'reveal-payout-account': {
      // Coordonnées en clair pour effectuer un virement : admin seulement, chaque affichage est journalisé.
      const acc = check(await db.from('seller_payout_accounts').select('id, user_id, kind, holder_name, bank_name, country, operator, secret_ciphertext').eq('id', body.accountId).single());
      await audit('payout_account.reveal', 'payout_account', acc.id, { seller: acc.user_id });
      return json({ id: acc.id, kind: acc.kind, holderName: acc.holder_name, bankName: acc.bank_name, country: acc.country, operator: acc.operator, value: await decryptSecret(acc.secret_ciphertext) });
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
