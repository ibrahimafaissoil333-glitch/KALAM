// Envoie les e-mails en attente (table email_outbox). Appelée par pg_cron chaque minute en production.
// Pilotes : MAIL_DRIVER=resend (API HTTP) ou console (développement : journalisé puis marqué envoyé).
import { env, handler, HttpError, json, serviceClient } from '../_shared/http.ts';

Deno.serve(handler(async (req) => {
  const secret = env('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) throw new HttpError(401, 'Non autorisé.');
  const db = serviceClient();
  const { data: batch } = await db.from('email_outbox').select('*').is('sent_at', null).is('error', null).order('id').limit(50);
  let sent = 0;
  for (const m of batch ?? []) {
    try {
      if (env('MAIL_DRIVER', 'console') === 'resend') {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: env('MAIL_FROM', 'Folio <no-reply@folio.local>'), to: m.to_email, subject: m.subject, text: m.body }),
        });
        if (!r.ok) throw new Error(`Resend ${r.status}`);
      } else {
        console.log(`\n→ ${m.to_email}\nObjet : ${m.subject}\n${m.body}\n`);
      }
      await db.from('email_outbox').update({ sent_at: new Date().toISOString() }).eq('id', m.id);
      sent++;
    } catch (err) {
      await db.from('email_outbox').update({ error: String(err).slice(0, 500) }).eq('id', m.id);
    }
  }
  return json({ sent, pending: (batch?.length ?? 0) - sent });
}));
