import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminEbooksController } from './admin/admin-ebooks.controller.js';
import { AdminController } from './admin/admin.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { CartController } from './cart/cart.controller.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { AuditService } from './common/audit.service.js';
import { JwtAuthGuard, RolesGuard } from './common/auth.js';
import { PrismaService } from './common/prisma.service.js';
import { AppConfig, CONFIG, loadConfig } from './config.js';
import { LibraryController } from './library/library.controller.js';
import { MailService } from './mail/mail.service.js';
import { MeController } from './me/me.controller.js';
import { FakeCheckoutController, OrdersController, WebhooksController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { FakePaymentProvider } from './payments/fake.provider.js';
import { PAYMENT_PROVIDER } from './payments/provider.js';
import { StripePaymentProvider } from './payments/stripe.provider.js';
import { SettingsService } from './settings/settings.service.js';
import { FilesController } from './storage/files.controller.js';
import { StorageService } from './storage/storage.service.js';

@ApiTags('Système')
@SkipThrottle()
@Controller()
class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'down', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok', time: new Date() };
  }

  /** Configuration publique lue au démarrage de l'app mobile. */
  @Get('config')
  async config() {
    const s = await this.settings.get();
    return {
      appName: s.appName,
      checkoutMode: s.checkoutMode,
      webCheckoutUrl: s.webCheckoutUrl,
      supportEmail: s.supportEmail,
      legal: { terms: s.termsUrl, salesTerms: s.salesTermsUrl, privacy: s.privacyUrl, legalNotice: s.legalNoticeUrl },
    };
  }
}

const config = loadConfig();

@Module({
  imports: [
    JwtModule.register({ secret: config.jwtAccessSecret }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: config.throttle.globalPerMinute }]),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    SystemController,
    AuthController,
    CatalogController,
    CartController,
    OrdersController,
    WebhooksController,
    FakeCheckoutController,
    LibraryController,
    MeController,
    FilesController,
    AdminEbooksController,
    AdminController,
  ],
  providers: [
    { provide: CONFIG, useValue: config },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: PAYMENT_PROVIDER,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) =>
        cfg.payment.provider === 'stripe'
          ? new StripePaymentProvider(cfg.payment.stripeSecretKey, cfg.payment.stripeWebhookSecret)
          : new FakePaymentProvider(cfg.payment.fakeWebhookSecret, cfg.publicApiUrl),
    },
    PrismaService,
    AuditService,
    SettingsService,
    MailService,
    StorageService,
    AuthService,
    OrdersService,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class AppModule {
  constructor(@Inject(CONFIG) readonly cfg: AppConfig) {}
}
