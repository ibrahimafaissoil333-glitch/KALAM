import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard, OptionalAuth } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import { normalize } from '../common/util.js';
import { BookContent, previewOf } from '../epub/epub.js';
import type { Prisma } from '../generated/prisma/client.js';
import { StorageService } from '../storage/storage.service.js';
import { toPublicEbook } from './ebook-view.js';

export const SORTS = { new: 'Nouveautés', title: 'Titre A → Z', author: 'Auteur A → Z' } as const;

class CatalogQuery {
  @ApiPropertyOptional({ description: 'Titre, auteur, catégorie ou mot-clé (insensible aux accents)' })
  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Slug de catégorie' })
  @IsOptional() @IsString() @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ enum: Object.keys(SORTS) })
  @IsOptional() @IsIn(Object.keys(SORTS))
  sort?: keyof typeof SORTS;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  pageSize?: number;
}

const PUBLISHED: Prisma.EbookWhereInput = { status: 'PUBLISHED', priceCents: { not: null } };

@ApiTags('Catalogue')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@OptionalAuth()
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async ownedSet(user?: AuthUser) {
    if (!user) return new Set<string>();
    const rows = await this.prisma.entitlement.findMany({ where: { userId: user.id, revokedAt: null }, select: { ebookId: true } });
    return new Set(rows.map((r) => r.ebookId));
  }

  private orderBy(sort: CatalogQuery['sort']): Prisma.EbookOrderByWithRelationInput[] {
    if (sort === 'title') return [{ title: 'asc' }];
    if (sort === 'author') return [{ author: 'asc' }, { title: 'asc' }];
    return [{ publishedAt: 'desc' }, { title: 'asc' }];
  }

  @Get('categories')
  categories() {
    return this.prisma.category.findMany({ orderBy: { order: 'asc' }, select: { name: true, slug: true } });
  }

  @Get('ebooks')
  @ApiOperation({ summary: 'Liste paginée des e-books publiés, avec recherche, filtre et tri' })
  async list(@Query() query: CatalogQuery, @CurrentUser() user?: AuthUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.EbookWhereInput = { ...PUBLISHED };
    if (query.category) where.category = { slug: query.category };
    if (query.q?.trim()) {
      // Tous les mots doivent apparaître dans le texte de recherche normalisé.
      where.AND = normalize(query.q).split(/\s+/).map((w) => ({ searchText: { contains: w } }));
    }
    const [total, rows, owned] = await Promise.all([
      this.prisma.ebook.count({ where }),
      this.prisma.ebook.findMany({
        where,
        include: { category: true, files: { where: { kind: 'COVER' } } },
        orderBy: this.orderBy(query.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.ownedSet(user),
    ]);
    return {
      items: await Promise.all(rows.map((e) => toPublicEbook(e, this.storage, owned.has(e.id)))),
      total,
      page,
      pageSize,
      sorts: SORTS,
    };
  }

  @Get('home')
  @ApiOperation({ summary: "Données de l'accueil : sélection, dernières parutions, catégories" })
  async home(@CurrentUser() user?: AuthUser) {
    const include = { category: true, files: { where: { kind: 'COVER' as const } } };
    const [featured, latest, categories, owned] = await Promise.all([
      this.prisma.ebook.findMany({ where: { ...PUBLISHED, featured: true }, include, orderBy: { publishedAt: 'desc' }, take: 8 }),
      this.prisma.ebook.findMany({ where: PUBLISHED, include, orderBy: { publishedAt: 'desc' }, take: 3 }),
      this.categories(),
      this.ownedSet(user),
    ]);
    const view = (e: (typeof featured)[number]) => toPublicEbook(e, this.storage, owned.has(e.id));
    return {
      featured: await Promise.all(featured.map(view)),
      latest: await Promise.all(latest.map(view)),
      categories,
    };
  }

  @Get('ebooks/:slug')
  @ApiOperation({ summary: "Fiche d'un e-book publié (ou possédé, même dépublié)" })
  async detail(@Param('slug') slug: string, @CurrentUser() user?: AuthUser) {
    const e = await this.prisma.ebook.findUnique({ where: { slug }, include: { category: true, files: { where: { kind: 'COVER' } } } });
    const owned = await this.ownedSet(user);
    if (!e || (e.status !== 'PUBLISHED' && !owned.has(e.id))) throw new NotFoundException('E-book introuvable.');
    await this.prisma.ebookView.create({ data: { ebookId: e.id } });
    return toPublicEbook(e, this.storage, owned.has(e.id));
  }

  @Get('ebooks/:slug/preview')
  @ApiOperation({ summary: 'Extrait gratuit, sans compte' })
  async preview(@Param('slug') slug: string) {
    const e = await this.prisma.ebook.findFirst({ where: { slug, status: 'PUBLISHED' }, include: { files: { where: { kind: 'CONTENT' } } } });
    const file = e?.files[0];
    if (!e || !file) throw new NotFoundException('Aucun extrait disponible.');
    const content = JSON.parse((await this.storage.get(file.storageKey)).toString('utf8')) as BookContent;
    return { ...previewOf(content, e.previewBlocks), ebookId: e.id, title: e.title, preview: true };
  }
}
