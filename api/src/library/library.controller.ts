import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, DeviceId, JwtAuthGuard } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import { toPublicEbook } from '../catalog/ebook-view.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';

class ProgressDto {
  @ApiProperty() @IsInt() @Min(0) @Max(100_000)
  chapterIndex: number;

  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000)
  blockIndex: number;

  @ApiProperty() @IsInt() @Min(0) @Max(100)
  percent: number;
}

@ApiTags('Bibliothèque')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('library')
export class LibraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  /** Vérifie le droit du compte connecté. Sans droit actif : 403 (CA-19, CA-22). */
  private async entitlement(userId: string, ebookId: string) {
    const ent = await this.prisma.entitlement.findFirst({
      where: { userId, ebookId, revokedAt: null },
      include: { ebook: { include: { files: true, category: true } } },
    });
    if (!ent) throw new ForbiddenException("Vous n'avez pas accès à cet e-book.");
    return ent;
  }

  @Get()
  @ApiOperation({ summary: 'E-books acquis, avec la progression de lecture' })
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.entitlement.findMany({
      where: { userId: user.id, revokedAt: null },
      include: { ebook: { include: { category: true, files: { where: { kind: { in: ['COVER', 'CONTENT'] } } } } } },
      orderBy: { grantedAt: 'desc' },
    });
    const progress = await this.prisma.readingProgress.findMany({ where: { userId: user.id } });
    const byId = new Map(progress.map((p) => [p.ebookId, p]));
    return Promise.all(
      rows.map(async (r) => {
        const p = byId.get(r.ebookId);
        return {
          ...(await toPublicEbook(r.ebook, this.storage, true)),
          grantedAt: r.grantedAt,
          readable: r.ebook.files.some((f) => f.kind === 'CONTENT'),
          // Le serveur ne fait jamais confiance au cache de l'appareil : `contentVersion` invalide le hors-ligne.
          contentVersion: r.ebook.files.find((f) => f.kind === 'CONTENT')?.id ?? null,
          progress: p ? { chapterIndex: p.chapterIndex, blockIndex: p.blockIndex, percent: p.percent, updatedAt: p.updatedAt } : null,
        };
      }),
    );
  }

  @Get(':ebookId/content')
  @ApiOperation({ summary: 'Contenu complet pour le lecteur (chapitres en blocs de texte)' })
  async content(@CurrentUser() user: AuthUser, @Param('ebookId', ParseUUIDPipe) ebookId: string, @DeviceId() deviceId: string | undefined, @Ip() ip: string) {
    const ent = await this.entitlement(user.id, ebookId);
    const file = ent.ebook.files.find((f) => f.kind === 'CONTENT');
    if (!file) throw new NotFoundException("Le contenu de cet e-book n'est pas encore disponible.");
    await this.prisma.downloadEvent.create({ data: { userId: user.id, ebookId, kind: 'read', deviceId, ip } });
    const content = JSON.parse((await this.storage.get(file.storageKey)).toString('utf8'));
    return { ebookId, contentVersion: file.id, ...content };
  }

  @Post(':ebookId/download-url')
  @HttpCode(200)
  @ApiOperation({ summary: 'URL signée et temporaire du fichier original, si le téléchargement est autorisé' })
  async downloadUrl(@CurrentUser() user: AuthUser, @Param('ebookId', ParseUUIDPipe) ebookId: string, @DeviceId() deviceId: string | undefined, @Ip() ip: string) {
    const ent = await this.entitlement(user.id, ebookId);
    if (!ent.ebook.downloadAllowed) throw new ForbiddenException("Le téléchargement du fichier n'est pas proposé pour cet e-book.");
    const file = ent.ebook.files.find((f) => f.kind === 'MAIN');
    if (!file) throw new NotFoundException('Fichier indisponible.');
    const { maxDownloadsPerBook } = await this.settings.get();
    if (maxDownloadsPerBook !== null) {
      const used = await this.prisma.downloadEvent.count({ where: { userId: user.id, ebookId, kind: 'download' } });
      if (used >= maxDownloadsPerBook) {
        throw new HttpException(`Limite de ${maxDownloadsPerBook} téléchargements atteinte pour cet e-book. Contactez le support.`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    await this.prisma.downloadEvent.create({ data: { userId: user.id, ebookId, kind: 'download', deviceId, ip } });
    const ext = file.mimeType === 'application/pdf' ? 'pdf' : 'epub';
    return this.storage.signedUrl(file.storageKey, `${ent.ebook.slug}.${ext}`);
  }

  @Put(':ebookId/progress')
  @ApiOperation({ summary: 'Enregistrer la progression (dernier écrit gagne)' })
  async progress(@CurrentUser() user: AuthUser, @Param('ebookId', ParseUUIDPipe) ebookId: string, @Body() dto: ProgressDto) {
    await this.entitlement(user.id, ebookId);
    const data = { chapterIndex: dto.chapterIndex, blockIndex: dto.blockIndex, percent: dto.percent, updatedAt: new Date() };
    return this.prisma.readingProgress.upsert({
      where: { userId_ebookId: { userId: user.id, ebookId } },
      create: { userId: user.id, ebookId, ...data },
      update: data,
      select: { chapterIndex: true, blockIndex: true, percent: true, updatedAt: true },
    });
  }
}
