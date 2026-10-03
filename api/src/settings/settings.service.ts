import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

export type CheckoutMode = 'external' | 'web_only';

/**
 * Paramètres modifiables depuis l'admin. Chaque valeur « à définir » du CDC est ici,
 * avec une valeur par défaut neutre. `null` signifie « sans limite ».
 */
export interface AppSettings {
  appName: string;
  checkoutMode: { ios: CheckoutMode; android: CheckoutMode };
  webCheckoutUrl: string | null;
  maxDevices: number | null;
  maxDownloadsPerBook: number | null;
  supportEmail: string | null;
  termsUrl: string | null;
  salesTermsUrl: string | null;
  privacyUrl: string | null;
  legalNoticeUrl: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  appName: process.env.APP_NAME || 'Folio',
  checkoutMode: { ios: 'external', android: 'external' },
  webCheckoutUrl: null,
  maxDevices: null,
  maxDownloadsPerBook: null,
  supportEmail: null,
  termsUrl: null,
  salesTermsUrl: null,
  privacyUrl: null,
  legalNoticeUrl: null,
};

const KEY = 'app';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AppSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AppSettings>) ?? {}) };
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...(await this.get()), ...patch };
    await this.prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next as object },
      update: { value: next as object },
    });
    return next;
  }
}
