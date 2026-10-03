import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { AuditService } from '../common/audit.service.js';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { anonymizeUser } from '../me/me.controller.js';
import { OrdersService } from '../orders/orders.service.js';
import { AppSettings, SettingsService } from '../settings/settings.service.js';

const ORDER_STATUSES = ['PENDING', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED'] as const;

class OrdersQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(ORDER_STATUSES) status?: (typeof ORDER_STATUSES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

class UsersQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED', 'DELETED']) status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  @IsOptional() @IsIn(['CUSTOMER', 'ADMIN']) role?: 'CUSTOMER' | 'ADMIN';
}

class UserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED']) status: 'ACTIVE' | 'SUSPENDED';
}

class StatsQuery {
  @IsOptional() @IsIn(['7d', '30d', '90d', '12m']) period?: '7d' | '30d' | '90d' | '12m';
}

class SettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) appName?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() checkoutMode?: AppSettings['checkoutMode'];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.webCheckoutUrl !== null) @IsUrl() webCheckoutUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.maxDevices !== null) @IsInt() @Min(1) @Max(100) maxDevices?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.maxDownloadsPerBook !== null) @IsInt() @Min(1) @Max(1000) maxDownloadsPerBook?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.supportEmail !== null) @IsEmail() supportEmail?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.termsUrl !== null) @IsUrl() termsUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.salesTermsUrl !== null) @IsUrl() salesTermsUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.privacyUrl !== null) @IsUrl() privacyUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.legalNoticeUrl !== null) @IsUrl() legalNoticeUrl?: string | null;
}

const PAGE = 25;

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ── Commandes ────────────────────────────────────────────────

  private ordersWhere(q: OrdersQuery): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [{ reference: { contains: s, mode: 'insensitive' } }, { user: { email: { contains: s, mode: 'insensitive' } } }];
    }
    return where;
  }

  @Get('orders')
  async listOrders(@Query() q: OrdersQuery) {
    const where = this.ordersWhere(q);
    const page = q.page ?? 1;
    const [total, rows, counts] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: { items: true, user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE,
        take: PAGE,
      }),
      this.prisma.order.groupBy({ by: ['status'], _count: true, where: q.q ? this.ordersWhere({ q: q.q }) : {} }),
    ]);
    return {
      items: rows.map((o) => ({ ...this.orders.view(o), user: o.user })),
      total,
      page,
      pageSize: PAGE,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  @Get('orders/export.csv')
  @ApiOperation({ summary: 'Export CSV (sans donnée bancaire)' })
  async exportOrders(@Query() q: OrdersQuery, @Res() res: Response, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    const rows = await this.prisma.order.findMany({ where: this.ordersWhere(q), include: { items: true, user: true }, orderBy: { createdAt: 'desc' } });
    const cell = (v: unknown) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise l'injection de formules dans un tableur
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [
      ['reference', 'date', 'statut', 'client', 'email', 'articles', 'total', 'devise', 'tva', 'pays'].map(cell).join(';'),
      ...rows.map((o) =>
        [o.reference, o.createdAt.toISOString(), o.status, o.user.name, o.user.email, o.items.map((i) => i.title).join(' | '), (o.totalCents / 100).toFixed(2), o.currency, o.taxCents !== null ? (o.taxCents / 100).toFixed(2) : '', o.taxCountry]
          .map(cell)
          .join(';'),
      ),
    ];
    await this.audit.log({ actorId: admin.id, action: 'orders.export', meta: { count: rows.length, ...q }, ip });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="commandes-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + lines.join('\n'));
  }

  @Get('orders/:id')
  async getOrder(@Param('id', ParseUUIDPipe) id: string) {
    const o = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        user: { select: { id: true, name: true, email: true } },
        payments: { select: { provider: true, providerSessionId: true, providerPaymentId: true, status: true, amountCents: true, currency: true, failureReason: true, createdAt: true, updatedAt: true } },
      },
    });
    if (!o) throw new NotFoundException('Commande introuvable.');
    const events = await this.prisma.paymentEvent.findMany({ where: { orderId: id }, orderBy: { receivedAt: 'asc' } });
    return { ...this.orders.view(o), user: o.user, payments: o.payments, events, taxCountry: o.taxCountry, failedAt: o.failedAt, refundedAt: o.refundedAt, canceledAt: o.canceledAt };
  }

  @Post('orders/:id/refund')
  @HttpCode(200)
  async refund(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    await this.orders.refund(id, admin.id, ip);
    return this.getOrder(id);
  }

  // ── Utilisateurs ─────────────────────────────────────────────

  @Get('users')
  async listUsers(@Query() q: UsersQuery) {
    const where: Prisma.UserWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.role) where.role = q.role;
    if (q.q?.trim()) where.OR = [{ email: { contains: q.q.trim(), mode: 'insensitive' } }, { name: { contains: q.q.trim(), mode: 'insensitive' } }];
    const rows = await this.prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, _count: { select: { orders: { where: { status: 'PAID' } }, entitlements: { where: { revokedAt: null } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(({ _count, ...u }) => ({ ...u, paidOrders: _count.orders, ebooks: _count.entitlements }));
  }

  @Get('users/:id')
  async getUser(@Param('id', ParseUUIDPipe) id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true, status: true, createdAt: true, marketingConsent: true, deletedAt: true,
        orders: { select: { id: true, reference: true, status: true, totalCents: true, currency: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        entitlements: { where: { revokedAt: null }, select: { grantedAt: true, ebook: { select: { id: true, title: true } } } },
        devices: { select: { id: true, label: true, platform: true, lastSeenAt: true } },
      },
    });
    if (!u) throw new NotFoundException('Utilisateur introuvable.');
    return u;
  }

  @Patch('users/:id/status')
  async setUserStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UserStatusDto, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    if (id === admin.id) throw new BadRequestException('Vous ne pouvez pas modifier votre propre statut.');
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Utilisateur introuvable.');
    if (u.status === 'DELETED') throw new ConflictException('Ce compte est supprimé.');
    await this.prisma.user.update({ where: { id }, data: { status: dto.status } });
    if (dto.status === 'SUSPENDED') await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorId: admin.id, action: `user.${dto.status === 'SUSPENDED' ? 'suspend' : 'reactivate'}`, targetType: 'user', targetId: id, ip });
    return this.getUser(id);
  }

  @Get('users/:id/export')
  @ApiOperation({ summary: "Export RGPD des données d'un utilisateur (demande transmise au support)" })
  async exportUser(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    const data = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, name: true, createdAt: true, termsAcceptedAt: true, marketingConsent: true, marketingConsentAt: true,
        orders: { select: { reference: true, status: true, totalCents: true, currency: true, createdAt: true, items: { select: { title: true, priceCents: true } } } },
        entitlements: { select: { grantedAt: true, revokedAt: true, ebook: { select: { title: true } } } },
        devices: { select: { label: true, platform: true, createdAt: true } },
      },
    });
    if (!data) throw new NotFoundException('Utilisateur introuvable.');
    await this.audit.log({ actorId: admin.id, action: 'user.export', targetType: 'user', targetId: id, ip });
    return { exportedAt: new Date(), ...data };
  }

  @Post('users/:id/anonymize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Effacement RGPD : anonymise le compte, conserve les commandes' })
  async anonymize(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    if (id === admin.id) throw new BadRequestException('Vous ne pouvez pas anonymiser votre propre compte ici.');
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Utilisateur introuvable.');
    await anonymizeUser(this.prisma, id);
    await this.audit.log({ actorId: admin.id, action: 'user.anonymize', targetType: 'user', targetId: id, ip });
    return this.getUser(id);
  }

  // ── Statistiques ─────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Indicateurs : CA, commandes, panier moyen, ventes par semaine, top e-books' })
  async stats(@Query() q: StatsQuery) {
    const days = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 }[q.period ?? '30d'];
    const since = new Date(Date.now() - days * 86_400_000);
    const [paid, byStatus, views, top, weekly, recent, customers] = await Promise.all([
      this.prisma.order.aggregate({ where: { status: 'PAID', paidAt: { gte: since } }, _sum: { totalCents: true }, _count: true }),
      this.prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.ebookView.count({ where: { createdAt: { gte: since } } }),
      this.prisma.$queryRaw<{ id: string; title: string; sales: bigint; revenue: bigint; views: bigint }[]>`
        SELECT e.id, e.title,
          COUNT(oi.id) AS sales,
          COALESCE(SUM(oi."priceCents"), 0) AS revenue,
          (SELECT COUNT(*) FROM ebook_views v WHERE v."ebookId" = e.id AND v."createdAt" >= ${since}) AS views
        FROM ebooks e
        LEFT JOIN order_items oi ON oi."ebookId" = e.id
          AND oi."orderId" IN (SELECT id FROM orders WHERE status = 'PAID' AND "paidAt" >= ${since})
        GROUP BY e.id, e.title
        ORDER BY sales DESC, views DESC
        LIMIT 5`,
      this.prisma.$queryRaw<{ week: Date; revenue: bigint; orders: bigint }[]>`
        SELECT date_trunc('week', "paidAt") AS week, SUM("totalCents") AS revenue, COUNT(*) AS orders
        FROM orders WHERE status = 'PAID' AND "paidAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 6, include: { items: true, user: { select: { name: true, email: true } } } }),
      this.prisma.user.count({ where: { role: 'CUSTOMER', status: 'ACTIVE' } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    const attempted = (counts.PAID ?? 0) + (counts.FAILED ?? 0);
    const revenue = paid._sum.totalCents ?? 0;
    return {
      period: q.period ?? '30d',
      since,
      currency: 'EUR',
      revenueCents: revenue,
      paidOrders: paid._count,
      averageOrderCents: paid._count ? Math.round(revenue / paid._count) : 0,
      failureRate: attempted ? (counts.FAILED ?? 0) / attempted : 0,
      ordersByStatus: counts,
      views,
      activeCustomers: customers,
      weekly: weekly.map((w) => ({ week: w.week, revenueCents: Number(w.revenue), orders: Number(w.orders) })),
      topEbooks: top.map((t) => ({ id: t.id, title: t.title, sales: Number(t.sales), revenueCents: Number(t.revenue), views: Number(t.views) })),
      recentOrders: recent.map((o) => ({ ...this.orders.view(o), user: o.user })),
    };
  }

  // ── Paramètres et journal ────────────────────────────────────

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  async putSettings(@Body() dto: SettingsDto, @CurrentUser() admin: AuthUser, @Ip() ip: string) {
    if (dto.checkoutMode) {
      for (const k of ['ios', 'android'] as const) {
        if (!['external', 'web_only'].includes(dto.checkoutMode[k])) throw new BadRequestException(`checkoutMode.${k} : external ou web_only.`);
      }
    }
    const next = await this.settings.update(dto as Partial<AppSettings>);
    await this.audit.log({ actorId: admin.id, action: 'settings.update', meta: dto as Record<string, unknown>, ip });
    return next;
  }

  @Get('audit-logs')
  auditLogs(@Query('page') page = '1') {
    const p = Math.max(1, Number(page) || 1);
    return this.prisma.auditLog.findMany({
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (p - 1) * 50,
      take: 50,
    });
  }
}
