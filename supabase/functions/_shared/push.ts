import { env, serviceClient } from './http.ts';

/**
 * Notifications sur le téléphone via le service Expo Push. Chaque notification porte une image :
 * la couverture du livre concerné quand on la connaît, sinon le visuel Kalam.
 * (Android affiche l'image ; sur iPhone, elle demande une extension de notification.)
 */
type Db = ReturnType<typeof serviceClient>;
interface OutboxRow { id: number; to_email: string; kind: string; subject: string; body: string }

const publicUrl = () => env('PUBLIC_SUPABASE_URL', env('SUPABASE_URL'));
export const brandImage = () => env('NOTIFICATION_IMAGE_URL', `${publicUrl()}/storage/v1/object/public/covers/brand/kalam.png`);

/** Couverture du premier livre de la commande citée (référence FO-…) ou du livre cité entre guillemets. */
async function imageFor(db: Db, row: OutboxRow) {
  const ref = `${row.subject}\n${row.body}`.match(/FO-[A-Z0-9]{8}/)?.[0];
  let ebookId: string | null = null;
  if (ref) {
    const { data } = await db.from('orders').select('order_items(ebook_id)').eq('reference', ref).maybeSingle();
    ebookId = data?.order_items?.[0]?.ebook_id ?? null;
  } else {
    const title = row.subject.match(/«\s*(.+?)\s*»/)?.[1];
    if (title) ebookId = (await db.from('ebooks').select('id').eq('title', title).limit(1).maybeSingle()).data?.id ?? null;
  }
  if (ebookId) {
    const { data: f } = await db.from('ebook_files').select('storage_path').eq('ebook_id', ebookId).eq('kind', 'COVER').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (f) return `${publicUrl()}/storage/v1/object/public/covers/${f.storage_path}`;
  }
  return brandImage();
}

/** Texte court pour la notification : première phrase utile du corps de l'e-mail. */
function shortBody(body: string) {
  const line = body.split('\n').map((l) => l.trim()).find((l) => l && !/^bonjour/i.test(l)) ?? '';
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

const SCREEN: Record<string, string> = {
  order_confirmed: '/library', seller_sale: '/seller', order_shipped: '/account/deliveries', payment_failed: '/cart',
  order_refunded: '/account/orders', listing_removed: '/seller',
};

/** Envoie les notifications en attente (une par e-mail transactionnel) ; renvoie le nombre envoyé. */
export async function sendPendingPushes(db: Db, limit = 50) {
  const { data: rows } = await db.from('email_outbox').select('id, to_email, kind, subject, body').is('push_sent_at', null).order('id').limit(limit);
  let sent = 0;
  for (const row of (rows ?? []) as OutboxRow[]) {
    const { data: profile } = await db.from('profiles').select('id').eq('email', row.to_email).maybeSingle();
    const { data: tokens } = profile ? await db.from('push_tokens').select('token').eq('user_id', profile.id) : { data: [] };
    if (tokens?.length) {
      const image = await imageFor(db, row);
      const messages = tokens.map((t: { token: string }) => ({
        to: t.token, title: row.subject, body: shortBody(row.body), sound: 'default', channelId: 'default',
        richContent: { image }, data: { url: SCREEN[row.kind] ?? '/', image, kind: row.kind },
      }));
      try {
        const res = await fetch(env('EXPO_PUSH_URL', 'https://exp.host/--/api/v2/push/send'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...(env('EXPO_ACCESS_TOKEN') ? { authorization: `Bearer ${env('EXPO_ACCESS_TOKEN')}` } : {}) },
          body: JSON.stringify(messages),
        });
        const json = await res.json().catch(() => ({}));
        // Jetons d'appareils désinstallés : supprimés.
        (json.data ?? []).forEach(async (r: { status: string; details?: { error?: string } }, i: number) => {
          if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') await db.from('push_tokens').delete().eq('token', messages[i].to);
        });
        sent += messages.length;
      } catch (err) {
        console.error('push', err);
      }
    }
    await db.from('email_outbox').update({ push_sent_at: new Date().toISOString() }).eq('id', row.id);
  }
  return sent;
}
