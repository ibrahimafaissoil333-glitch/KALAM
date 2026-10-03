import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsHexColor, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuditService } from '../common/audit.service.js';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import { normalize, slugify } from '../common/util.js';
import { EpubError, parseEpub } from '../epub/epub.js';
import type { Ebook, Prisma } from '../generated/prisma/client.js';
import { toPublicEbook } from '../catalog/ebook-view.js';
import { StorageService } from '../storage/storage.service.js';

class EbookDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200)
  title?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  author?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000)
  description?: string;

  @ApiPropertyOptional({ description: 'Nom de catégorie (créée si absente)' }) @IsOptional() @IsString() @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ description: 'Prix TTC en centimes ; vide = prix à définir (non publiable)', nullable: true })
  @IsOptional() @IsInt() @Min(0) @Max(100_000_00)
  priceCents?: number | null;

  @ApiPropertyOptional({ example: 'EUR' }) @IsOptional() @IsString() @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20)
  format?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000)
  pages?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  downloadAllowed?: boolean;

  @ApiPropertyOptional({ description: "Nombre de blocs de texte de l'extrait gratuit" }) @IsOptional() @IsInt() @Min(0) @Max(500)
  previewBlocks?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsHexColor()
  coverBg?: string;

  @ApiPropertyOptional() @IsOptional() @IsHexColor()
  coverFg?: string;

  @ApiPropertyOptional() @IsOptional() @IsHexColor()
  coverTint?: string;
}

class CreateEbookDto extends EbookDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200)
  declare title: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120)
  declare author: string;
}

class ListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED']) status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD = 100 * 1024 * 1024;

@ApiTags('Admin — E-books')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/ebooks')
export class AdminEbooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async categoryId(name?: string) {
    if (name === undefined) return undefined;
    if (!name.trim()) return null;
    const cat = await this.prisma.category.upsert({
      where: { name: name.trim() },
      create: { name: name.trim(), slug: slugify(name), order: await this.prisma.category.count() },
      update: {},
    });
    return cat.id;
  }

  private searchText(e: { title: string; author: string; description?: string }, category?: string | null) {
    return normalize([e.title, e.author, category ?? '', e.description ?? ''].join(' '));
  }

  private async uniqueSlug(title: string, exceptId?: string) {
    const base = slugify(title) || 'ebook';
    for (let i = 1; ; i++) {
      const slug = i === 1 ? base : `${base}-${i}`;
      const other = await this.prisma.ebook.findUnique({ where: { slug } });
      if (!other || other.id === exceptId) return slug;
    }
  }

  private async detail(id: string) {
    const e = await this.prisma.ebook.findUnique({ where: { id }, include: { category: true, files: true, _count: { select: { orderItems: { where: { order: { status: 'PAID' } } } } } } });
    if (!e) throw new NotFoundException('E-book introuvable.');
    return {
      ...(await toPublicEbook(e, this.storage)),
      status: e.status,
      featured: e.featured,
      previewBlocks: e.previewBlocks,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      sales: e._count.orderItems,
      files: e.files.map((f) => ({ id: f.id, kind: f.kind, mimeType: f.mimeType, sizeBytes: f.sizeBytes, originalName: f.originalName, createdAt: f.createdAt })),
      publishable: this.publishProblems(e),
    };
  }

  /** Conditions de publication : la liste est vide quand l'e-book peut être publié. */
  private publishProblems(e: Ebook & { files: { kind: string }[]; categoryId: string | null }) {
    const p: string[] = [];
    if (e.priceCents === null) p.push('Prix à définir');
    if (!e.description.trim()) p.push('Description manquante');
    if (!e.categoryId) p.push('Catégorie manquante');
    if (!e.files.some((f) => f.kind === 'MAIN')) p.push('Fichier principal manquant');
    if (!e.files.some((f) => f.kind === 'CONTENT')) p.push('Contenu lisible non extrait (EPUB requis pour la lecture dans l’app)');
    return p;
  }

  @Get()
  async list(@Query() q: ListQuery) {
    const where: Prisma.EbookWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.q?.trim()) where.AND = normalize(q.q).split(/\s+/).map((w) => ({ searchText: { contains: w } }));
    const rows = await this.prisma.ebook.findMany({
      where,
      include: { category: true, files: { where: { kind: 'COVER' } }, _count: { select: { orderItems: { where: { order: { status: 'PAID' } } } } } },
      orderBy: { updatedAt: 'desc' },
    });
    return Promise.all(rows.map(async (e) => ({ ...(await toPublicEbook(e, this.storage)), status: e.status, featured: e.featured, updatedAt: e.updatedAt, sales: e._count.orderItems })));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.detail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Créer un brouillon' })
  async create(@Body() dto: CreateEbookDto, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    const { category, ...rest } = dto;
    const categoryId = await this.categoryId(category);
    const e = await this.prisma.ebook.create({
      data: { ...rest, slug: await this.uniqueSlug(dto.title), categoryId: categoryId ?? null, searchText: this.searchText(dto, category) },
    });
    await this.audit.log({ actorId: admin.id, action: 'ebook.create', targetType: 'ebook', targetId: e.id, meta: { title: e.title }, ip });
    return this.detail(e.id);
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EbookDto, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    const current = await this.prisma.ebook.findUnique({ where: { id }, include: { category: true } });
    if (!current) throw new NotFoundException('E-book introuvable.');
    const { category, ...rest } = dto;
    const categoryId = await this.categoryId(category);
    const merged = { title: dto.title ?? current.title, author: dto.author ?? current.author, description: dto.description ?? current.description };
    const catName = category !== undefined ? category : current.category?.name;
    await this.prisma.ebook.update({
      where: { id },
      data: {
        ...rest,
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(dto.title && dto.title !== current.title && current.status === 'DRAFT' && !current.publishedAt ? { slug: await this.uniqueSlug(dto.title, id) } : {}),
        searchText: this.searchText(merged, catName),
      },
    });
    if (dto.priceCents !== undefined && dto.priceCents !== current.priceCents) {
      await this.audit.log({ actorId: admin.id, action: 'ebook.price', targetType: 'ebook', targetId: id, meta: { from: current.priceCents, to: dto.priceCents }, ip });
    }
    return this.detail(id);
  }

  @Post(':id/files/:kind')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Envoyer la couverture (JPEG/PNG/WebP) ou le fichier principal (EPUB/PDF)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD } }))
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kindRaw: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() admin: AuthUser,
    @Ip() ip: string,
  ) {
    const kind = kindRaw.toUpperCase();
    if (kind !== 'COVER' && kind !== 'MAIN') throw new BadRequestException('Type de fichier attendu : cover ou main.');
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    const ebook = await this.prisma.ebook.findUnique({ where: { id } });
    if (!ebook) throw new NotFoundException('E-book introuvable.');

    const replace = async (k: 'COVER' | 'MAIN' | 'CONTENT', body: Buffer, mimeType: string, ext: string, originalName = '') => {
      const old = await this.prisma.file.findMany({ where: { ebookId: id, kind: k } });
      const key = StorageService.keyFor(id, k, ext);
      await this.storage.put(key, body, mimeType);
      await this.prisma.file.create({ data: { ebookId: id, kind: k, storageKey: key, mimeType, sizeBytes: body.length, originalName } });
      for (const o of old) {
        await this.prisma.file.delete({ where: { id: o.id } });
        await this.storage.delete(o.storageKey);
      }
    };

    if (kind === 'COVER') {
      if (!COVER_TYPES.includes(file.mimetype)) throw new BadRequestException('Couverture : JPEG, PNG ou WebP attendu.');
      await replace('COVER', file.buffer, file.mimetype, file.mimetype.split('/')[1], file.originalname);
    } else {
      const isEpub = file.originalname.toLowerCase().endsWith('.epub') || file.mimetype === 'application/epub+zip';
      const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
      if (!isEpub && !isPdf) throw new BadRequestException('Fichier principal : EPUB ou PDF attendu.');
      if (isEpub) {
        let content;
        try {
          content = parseEpub(file.buffer);
        } catch (err) {
          throw new BadRequestException(err instanceof EpubError ? err.message : 'EPUB illisible.');
        }
        await replace('MAIN', file.buffer, 'application/epub+zip', 'epub', file.originalname);
        await replace('CONTENT', Buffer.from(JSON.stringify(content)), 'application/json', 'json');
        await this.prisma.ebook.update({ where: { id }, data: { format: ebook.format ?? 'EPUB', pages: ebook.pages ?? Math.max(1, Math.round(content.wordCount / 250)) } });
      } else {
        await replace('MAIN', file.buffer, 'application/pdf', 'pdf', file.originalname);
        await this.prisma.ebook.update({ where: { id }, data: { format: ebook.format ?? 'PDF' } });
      }
    }
    await this.audit.log({ actorId: admin.id, action: `ebook.upload.${kind.toLowerCase()}`, targetType: 'ebook', targetId: id, meta: { name: file.originalname, size: file.size }, ip });
    return this.detail(id);
  }

  @Post(':id/publish')
  @HttpCode(200)
  async publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    const e = await this.prisma.ebook.findUnique({ where: { id }, include: { files: true } });
    if (!e) throw new NotFoundException('E-book introuvable.');
    const problems = this.publishProblems(e);
    if (problems.length) throw new BadRequestException(`Publication impossible : ${problems.join(', ')}.`);
    await this.prisma.ebook.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: e.publishedAt ?? new Date() } });
    await this.audit.log({ actorId: admin.id, action: 'ebook.publish', targetType: 'ebook', targetId: id, meta: { title: e.title }, ip });
    return this.detail(id);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dépublier : retiré du catalogue, toujours lisible par les acheteurs (règle D12)' })
  async unpublish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    await this.prisma.ebook.update({ where: { id }, data: { status: 'DRAFT' } });
    await this.audit.log({ actorId: admin.id, action: 'ebook.unpublish', targetType: 'ebook', targetId: id, ip });
    return this.detail(id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    await this.prisma.ebook.update({ where: { id }, data: { status: 'ARCHIVED', featured: false } });
    await this.audit.log({ actorId: admin.id, action: 'ebook.archive', targetType: 'ebook', targetId: id, ip });
    return this.detail(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer définitivement un brouillon jamais commandé' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    const e = await this.prisma.ebook.findUnique({ where: { id }, include: { files: true, _count: { select: { orderItems: true, entitlements: true } } } });
    if (!e) throw new NotFoundException('E-book introuvable.');
    if (e.status !== 'DRAFT' || e._count.orderItems || e._count.entitlements) {
      throw new ConflictException('Seul un brouillon jamais commandé peut être supprimé. Archivez-le plutôt.');
    }
    await this.prisma.ebook.delete({ where: { id } });
    for (const f of e.files) await this.storage.delete(f.storageKey);
    await this.audit.log({ actorId: admin.id, action: 'ebook.delete', targetType: 'ebook', targetId: id, meta: { title: e.title }, ip });
  }
}
