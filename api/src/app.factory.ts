import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AppConfig, CONFIG } from './config.js';

/** Crée l'application (utilisé par main.ts, les tests et l'export OpenAPI). */
export async function createApp(opts: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // nécessaire pour vérifier la signature des webhooks
    logger: opts.logger === false ? false : undefined,
  });
  const cfg = app.get<AppConfig>(CONFIG);
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({ origin: cfg.corsOrigins.length ? cfg.corsOrigins : false, credentials: true });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return app;
}

export function openApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('API Folio')
    .setDescription("Vente et lecture d'e-books — application mobile et administration. Toutes les routes sont préfixées par /v1.")
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
