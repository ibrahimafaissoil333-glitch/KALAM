import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import { toPublicEbook } from '../catalog/ebook-view.js';
import { StorageService } from '../storage/storage.service.js';

class AddItemDto {
  @ApiProperty() @IsUUID()
  ebookId: string;
}

class MergeDto {
  @ApiProperty({ type: [String], description: "Identifiants du panier invité conservé sur l'appareil" })
  @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true })
  ebookIds: string[];
}

@ApiTags('Panier')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async cartId(userId: string) {
    const cart = await this.prisma.cart.upsert({ where: { userId }, create: { userId }, update: {} });
    return cart.id;
  }

  private async view(userId: string) {
    const cartId = await this.cartId(userId);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId },
      include: { ebook: { include: { category: true, files: { where: { kind: 'COVER' } } } } },
      orderBy: { addedAt: 'asc' },
    });
    // Un e-book dépublié, sans prix ou déjà acquis ne peut pas être acheté : il est retiré du panier.
    const owned = new Set(
      (await this.prisma.entitlement.findMany({ where: { userId, revokedAt: null }, select: { ebookId: true } })).map((e) => e.ebookId),
    );
    const invalid = items.filter((i) => i.ebook.status !== 'PUBLISHED' || i.ebook.priceCents === null || owned.has(i.ebookId));
    if (invalid.length) {
      await this.prisma.cartItem.deleteMany({ where: { cartId, ebookId: { in: invalid.map((i) => i.ebookId) } } });
    }
    const valid = items.filter((i) => !invalid.includes(i));
    const subtotalCents = valid.reduce((n, i) => n + (i.ebook.priceCents ?? 0), 0);
    return {
      items: await Promise.all(valid.map((i) => toPublicEbook(i.ebook, this.storage))),
      count: valid.length,
      subtotalCents,
      // Taxes : prix TTC ; le détail est calculé par le prestataire de paiement (docs/01-cadrage.md, D4).
      taxIncluded: true,
      totalCents: subtotalCents,
      currency: valid[0]?.ebook.currency ?? 'EUR',
      removed: invalid.map((i) => i.ebook.title),
    };
  }

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.view(user.id);
  }

  @Post('items')
  @ApiOperation({ summary: 'Ajouter un e-book (quantité 1, pas de doublon)' })
  async add(@CurrentUser() user: AuthUser, @Body() dto: AddItemDto) {
    const ebook = await this.prisma.ebook.findFirst({ where: { id: dto.ebookId, status: 'PUBLISHED', priceCents: { not: null } } });
    if (!ebook) throw new NotFoundException('E-book indisponible.');
    if (await this.prisma.entitlement.findFirst({ where: { userId: user.id, ebookId: ebook.id, revokedAt: null } })) {
      throw new ConflictException('Cet e-book est déjà dans votre bibliothèque.');
    }
    const cartId = await this.cartId(user.id);
    await this.prisma.cartItem.upsert({
      where: { cartId_ebookId: { cartId, ebookId: ebook.id } },
      create: { cartId, ebookId: ebook.id },
      update: {},
    });
    return this.view(user.id);
  }

  @Delete('items/:ebookId')
  async remove(@CurrentUser() user: AuthUser, @Param('ebookId', ParseUUIDPipe) ebookId: string) {
    const cartId = await this.cartId(user.id);
    await this.prisma.cartItem.deleteMany({ where: { cartId, ebookId } });
    return this.view(user.id);
  }

  @Delete()
  @HttpCode(200)
  async clear(@CurrentUser() user: AuthUser) {
    const cartId = await this.cartId(user.id);
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
    return this.view(user.id);
  }

  @Post('merge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fusionner le panier invité dans le panier du compte, sans doublon (CA-13)' })
  async merge(@CurrentUser() user: AuthUser, @Body() dto: MergeDto) {
    if (!Array.isArray(dto.ebookIds)) throw new BadRequestException();
    const cartId = await this.cartId(user.id);
    const valid = await this.prisma.ebook.findMany({
      where: { id: { in: dto.ebookIds }, status: 'PUBLISHED', priceCents: { not: null } },
      select: { id: true },
    });
    await this.prisma.cartItem.createMany({ data: valid.map((e) => ({ cartId, ebookId: e.id })), skipDuplicates: true });
    return this.view(user.id);
  }
}
