import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { AppConfig, CONFIG } from '../config.js';
import { AuditService } from '../common/audit.service.js';
import { AccessPayload } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import { randomToken, sha256 } from '../common/util.js';
import { MailService } from '../mail/mail.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DeviceDto, LoginDto, RegisterDto } from './auth.dto.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const INVALID = 'E-mail ou mot de passe incorrect.';

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; email: string; role: string };
}

@Injectable()
export class AuthService {
  // Hachage factice : rend le temps de réponse identique, que le compte existe ou non.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async register(dto: RegisterDto): Promise<Session> {
    if (!dto.acceptTerms) throw new BadRequestException('Acceptez les conditions pour créer votre compte.');
    const email = dto.email.toLowerCase().trim();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Un compte existe déjà avec cette adresse e-mail.');
    }
    const now = new Date();
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
        termsAcceptedAt: now,
        marketingConsent: !!dto.marketingConsent,
        marketingConsentAt: dto.marketingConsent ? now : null,
        notificationPref: { create: { marketing: !!dto.marketingConsent } },
      },
    });
    this.mail.accountCreated(email, user.name);
    return this.issueSession(user, dto);
  }

  async login(dto: LoginDto, ip?: string): Promise<Session> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException('Trop de tentatives. Réessayez dans quelques minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = user?.passwordHash
      ? await argon2.verify(user.passwordHash, dto.password)
      : (await argon2.verify(await this.dummy(), dto.password), false);
    if (!user || !ok) {
      if (user) {
        const failed = user.failedLogins + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data: failed >= MAX_FAILED_LOGINS
            ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : { failedLogins: failed },
        });
      }
      throw new UnauthorizedException(INVALID);
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException(INVALID);
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    if (user.role === 'ADMIN') await this.audit.log({ actorId: user.id, action: 'admin.login', ip });
    return this.issueSession(user, dto);
  }

  private dummy() {
    this.dummyHash ??= argon2.hash(randomToken(), { type: argon2.argon2id });
    return this.dummyHash;
  }

  /**
   * Rotation : chaque jeton de rafraîchissement ne sert qu'une fois. Réutiliser un jeton
   * déjà remplacé signale un vol probable ; toute la famille de jetons est alors révoquée.
   */
  async refresh(refreshToken: string): Promise<Session> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!row) throw new UnauthorizedException('Session expirée.');
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Session expirée.');
    }
    if (row.expiresAt < new Date() || row.user.status !== 'ACTIVE') throw new UnauthorizedException('Session expirée.');
    const next = randomToken();
    // Mise à jour conditionnelle : deux rafraîchissements simultanés ne peuvent pas réussir tous les deux.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedBy: sha256(next) },
    });
    if (count === 0) throw new UnauthorizedException('Session expirée.');
    await this.prisma.refreshToken.create({
      data: {
        userId: row.userId,
        tokenHash: sha256(next),
        familyId: row.familyId,
        deviceId: row.deviceId,
        expiresAt: new Date(Date.now() + this.cfg.refreshTtlDays * 86_400_000),
      },
    });
    if (row.deviceId) await this.prisma.device.updateMany({ where: { id: row.deviceId }, data: { lastSeenAt: new Date() } });
    return {
      accessToken: await this.accessToken({ sub: row.user.id, role: row.user.role, did: row.deviceId ?? undefined }),
      refreshToken: next,
      expiresIn: this.cfg.jwtAccessTtl,
      user: this.publicUser(row.user),
    };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Réponse identique que le compte existe ou non (pas d'énumération des comptes). */
  async forgotPassword(emailRaw: string) {
    const email = emailRaw.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
    const token = randomToken();
    await this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + this.cfg.resetTokenTtlMinutes * 60_000) },
    });
    this.mail.passwordReset(email, `folio://reset?token=${token}`, this.cfg.resetTokenTtlMinutes);
  }

  async resetPassword(token: string, password: string) {
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien.');
    }
    const { count } = await this.prisma.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (count === 0) throw new BadRequestException('Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien.');
    await this.prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }), failedLogins: 0, lockedUntil: null },
    });
    // Toutes les sessions existantes sont fermées après un changement de mot de passe.
    await this.prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async registerDevice(userId: string, d: DeviceDto): Promise<string | undefined> {
    if (!d.deviceKey) return undefined;
    const existing = await this.prisma.device.findUnique({ where: { userId_deviceKey: { userId, deviceKey: d.deviceKey } } });
    if (existing) {
      await this.prisma.device.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), label: d.deviceLabel ?? existing.label } });
      return existing.id;
    }
    const { maxDevices } = await this.settings.get();
    if (maxDevices !== null && (await this.prisma.device.count({ where: { userId } })) >= maxDevices) {
      throw new ConflictException(`Nombre maximal d'appareils atteint (${maxDevices}). Retirez un appareil depuis votre compte.`);
    }
    const dev = await this.prisma.device.create({
      data: { userId, deviceKey: d.deviceKey, label: d.deviceLabel ?? 'Appareil', platform: d.platform ?? 'inconnu' },
    });
    return dev.id;
  }

  private async issueSession(user: { id: string; name: string; email: string | null; role: 'CUSTOMER' | 'ADMIN' }, d: DeviceDto): Promise<Session> {
    const deviceId = await this.registerDevice(user.id, d);
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId: randomUUID(),
        deviceId,
        expiresAt: new Date(Date.now() + this.cfg.refreshTtlDays * 86_400_000),
      },
    });
    return {
      accessToken: await this.accessToken({ sub: user.id, role: user.role, did: deviceId }),
      refreshToken,
      expiresIn: this.cfg.jwtAccessTtl,
      user: this.publicUser(user),
    };
  }

  private accessToken(p: AccessPayload) {
    return this.jwt.signAsync(p, { expiresIn: this.cfg.jwtAccessTtl });
  }

  private publicUser(u: { id: string; name: string; email: string | null; role: string }) {
    return { id: u.id, name: u.name, email: u.email ?? '', role: u.role };
  }
}
