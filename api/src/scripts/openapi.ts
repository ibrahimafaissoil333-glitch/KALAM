import { writeFileSync } from 'node:fs';
import { createApp, openApiDocument } from '../app.factory.js';

const app = await createApp({ logger: false });
const out = new URL('../../../docs/openapi.json', import.meta.url);
writeFileSync(out, JSON.stringify(openApiDocument(app), null, 2) + '\n');
await app.close();
console.log(`OpenAPI écrit dans ${out.pathname}`);
