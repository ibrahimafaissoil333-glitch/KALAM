/** Configuration typée, lue une seule fois depuis les variables d'environnement. */

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

function opt(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${name} doit être un entier`);
  return n;
}

export function loadConfig() {
  const env = opt('NODE_ENV', 'development');
  const isProd = env === 'production';
  const cfg = {
    env,
    isProd,
    isTest: env === 'test',
    port: int('PORT', 3000),
    publicApiUrl: opt('PUBLIC_API_URL', 'http://localhost:3000'),
    appName: opt('APP_NAME', 'Folio'),
    jwtAccessSecret: req('JWT_ACCESS_SECRET'),
    jwtAccessTtl: int('JWT_ACCESS_TTL_SECONDS', 900),
    refreshTtlDays: int('REFRESH_TTL_DAYS', 30),
    resetTokenTtlMinutes: int('RESET_TOKEN_TTL_MINUTES', 30),
    corsOrigins: opt('CORS_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
    storage: {
      driver: opt('STORAGE_DRIVER', 'local') as 'local' | 's3',
      localDir: opt('STORAGE_LOCAL_DIR', './storage'),
      signingSecret: req('STORAGE_SIGNING_SECRET'),
      signedUrlTtl: int('SIGNED_URL_TTL_SECONDS', 300),
      s3: {
        bucket: opt('S3_BUCKET'),
        region: opt('S3_REGION', 'fr-par'),
        endpoint: opt('S3_ENDPOINT'),
        accessKeyId: opt('S3_ACCESS_KEY_ID'),
        secretAccessKey: opt('S3_SECRET_ACCESS_KEY'),
      },
    },
    payment: {
      provider: opt('PAYMENT_PROVIDER', 'fake') as 'fake' | 'stripe',
      fakeWebhookSecret: opt('FAKE_WEBHOOK_SECRET'),
      stripeSecretKey: opt('STRIPE_SECRET_KEY'),
      stripeWebhookSecret: opt('STRIPE_WEBHOOK_SECRET'),
      returnUrl: opt('CHECKOUT_RETURN_URL', 'folio://checkout/return'),
      /** Préfixes acceptés pour l'adresse de retour fournie par l'app (protection contre les redirections ouvertes). */
      returnPrefixes: opt('CHECKOUT_RETURN_PREFIXES', env === 'production' ? 'folio://' : 'folio://,exp://').split(',').map((p) => p.trim()).filter(Boolean),
      pendingTtlMinutes: int('ORDER_PENDING_TTL_MINUTES', 60),
    },
    mail: {
      driver: opt('MAIL_DRIVER', 'console') as 'console' | 'smtp' | 'memory',
      from: opt('MAIL_FROM', 'Folio <no-reply@folio.local>'),
      smtpUrl: opt('SMTP_URL'),
    },
    throttle: {
      globalPerMinute: int('THROTTLE_GLOBAL_PER_MINUTE', 120),
      authPerMinute: int('THROTTLE_AUTH_PER_MINUTE', 10),
    },
  };
  if (isProd) {
    if (cfg.payment.provider === 'fake') throw new Error('PAYMENT_PROVIDER=fake interdit en production');
    if (cfg.mail.driver !== 'smtp') throw new Error('MAIL_DRIVER=smtp requis en production');
    if (cfg.jwtAccessSecret.length < 32 || cfg.storage.signingSecret.length < 32) {
      throw new Error('Les secrets doivent faire au moins 32 caractères en production');
    }
  }
  return cfg;
}

export type AppConfig = ReturnType<typeof loadConfig>;
export const CONFIG = Symbol('CONFIG');
