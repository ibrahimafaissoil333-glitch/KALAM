import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { AppConfig, CONFIG } from '../config.js';

export interface SentMail {
  to: string;
  subject: string;
  text: string;
  kind: string;
}

function euros(cents: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

/** E-mails transactionnels (CDC §13). Pilotes : console (dev), memory (tests), smtp (production). */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private transporter?: Transporter;
  /** Boîte de réception en mémoire, lue par les tests. */
  readonly outbox: SentMail[] = [];

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    if (cfg.mail.driver === 'smtp') this.transporter = nodemailer.createTransport(cfg.mail.smtpUrl);
  }

  private async send(mail: SentMail) {
    if (this.cfg.mail.driver === 'smtp' && this.transporter) {
      await this.transporter.sendMail({ from: this.cfg.mail.from, to: mail.to, subject: mail.subject, text: mail.text });
      return;
    }
    this.outbox.push(mail);
    if (this.outbox.length > 200) this.outbox.shift();
    if (this.cfg.mail.driver === 'console') {
      this.logger.log(`\n→ ${mail.to}\nObjet : ${mail.subject}\n${mail.text}\n`);
    }
  }

  /** Les envois ne doivent jamais faire échouer l'opération métier qui les déclenche. */
  private fire(mail: SentMail) {
    this.send(mail).catch((err) => this.logger.error(`Échec d'envoi (${mail.kind}) : ${err}`));
  }

  accountCreated(to: string, name: string) {
    const app = this.cfg.appName;
    this.fire({
      kind: 'account_created',
      to,
      subject: `Bienvenue sur ${app}`,
      text: `Bonjour ${name},\n\nVotre compte ${app} est créé. Vos achats seront disponibles dans votre bibliothèque, sur tous vos appareils.\n\nÀ bientôt,\nL'équipe ${app}`,
    });
  }

  passwordReset(to: string, link: string, ttlMinutes: number) {
    this.fire({
      kind: 'password_reset',
      to,
      subject: 'Réinitialisation de votre mot de passe',
      text: `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable ${ttlMinutes} minutes, utilisable une seule fois) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    });
  }

  orderConfirmed(to: string, ref: string, titles: string[], totalCents: number, currency: string) {
    this.fire({
      kind: 'order_confirmed',
      to,
      subject: `Commande ${ref} confirmée`,
      text: `Merci pour votre achat !\n\nCommande ${ref} — ${euros(totalCents, currency)}\n${titles.map((t) => `• ${t}`).join('\n')}\n\nVos e-books sont disponibles dans votre bibliothèque.`,
    });
  }

  paymentFailed(to: string, ref: string) {
    this.fire({
      kind: 'payment_failed',
      to,
      subject: `Paiement non abouti — commande ${ref}`,
      text: `Bonjour,\n\nLe paiement de la commande ${ref} n'a pas abouti. Aucun montant n'a été débité et votre panier est conservé. Vous pouvez réessayer depuis l'application.`,
    });
  }

  orderRefunded(to: string, ref: string) {
    this.fire({
      kind: 'order_refunded',
      to,
      subject: `Commande ${ref} remboursée`,
      text: `Bonjour,\n\nLa commande ${ref} a été remboursée. Les e-books concernés ne sont plus accessibles dans votre bibliothèque.`,
    });
  }
}
