import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { AppConfig, CONFIG } from '../config.js';
import { safeEqual } from '../common/util.js';

/**
 * Stockage privé des fichiers. Aucun fichier n'est public : l'accès passe toujours
 * par une URL signée de courte durée (SIGNED_URL_TTL_SECONDS).
 */
@Injectable()
export class StorageService {
  private s3?: S3Client;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    if (cfg.storage.driver === 's3') {
      const s = cfg.storage.s3;
      this.s3 = new S3Client({
        region: s.region,
        endpoint: s.endpoint || undefined,
        forcePathStyle: !!s.endpoint,
        credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
      });
    }
  }

  private localPath(key: string) {
    const root = resolve(this.cfg.storage.localDir);
    const p = resolve(root, normalize(key));
    if (!p.startsWith(root + '/')) throw new Error('Clé de stockage invalide');
    return p;
  }

  async put(key: string, body: Buffer, contentType: string) {
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.cfg.storage.s3.bucket, Key: key, Body: body, ContentType: contentType }));
      return;
    }
    const p = this.localPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }

  async get(key: string): Promise<Buffer> {
    if (this.s3) {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.storage.s3.bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    }
    return readFile(this.localPath(key));
  }

  async delete(key: string) {
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.storage.s3.bucket, Key: key }));
      return;
    }
    await rm(this.localPath(key), { force: true });
  }

  private sign(key: string, exp: number, disposition: string) {
    return createHmac('sha256', this.cfg.storage.signingSecret).update(`${key}\n${exp}\n${disposition}`).digest('base64url');
  }

  /** URL temporaire. `filename` force un téléchargement plutôt qu'un affichage. */
  async signedUrl(key: string, filename?: string, ttl = this.cfg.storage.signedUrlTtl): Promise<{ url: string; expiresAt: Date }> {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const disposition = filename ? `attachment; filename="${filename.replace(/"/g, '')}"` : 'inline';
    if (this.s3) {
      const url = await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: this.cfg.storage.s3.bucket, Key: key, ResponseContentDisposition: disposition }),
        { expiresIn: ttl },
      );
      return { url, expiresAt: new Date(exp * 1000) };
    }
    const qs = new URLSearchParams({ key, exp: String(exp), d: disposition, sig: this.sign(key, exp, disposition) });
    return { url: `${this.cfg.publicApiUrl}/v1/files/signed?${qs}`, expiresAt: new Date(exp * 1000) };
  }

  /** Vérifie une URL signée du pilote local. */
  verify(key: string, exp: number, disposition: string, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    return safeEqual(this.sign(key, exp, disposition), sig);
  }

  static keyFor(ebookId: string, kind: string, ext: string) {
    return join('ebooks', ebookId, `${kind.toLowerCase()}-${Date.now()}.${ext}`);
  }
}
