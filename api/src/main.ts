import { SwaggerModule } from '@nestjs/swagger';
import { createApp, openApiDocument } from './app.factory.js';
import { AppConfig, CONFIG } from './config.js';

const app = await createApp();
const cfg = app.get<AppConfig>(CONFIG);
if (!cfg.isProd) SwaggerModule.setup('docs', app, openApiDocument(app));
await app.listen(cfg.port, '0.0.0.0');
console.log(`API Folio prête sur ${cfg.publicApiUrl}/v1 (documentation : ${cfg.publicApiUrl}/docs)`);
