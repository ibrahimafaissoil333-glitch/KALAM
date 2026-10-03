import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import argon2 from 'argon2';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../common/audit.service.js';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import { PASSWORD_RULE, PASSWORD_RULE_MESSAGE } from '../common/util.js';

class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  name?: string;
}

class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(128)
  currentPassword: string;

  @ApiProperty() @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}

class NotificationsDto {
  @ApiProperty({ description: "Mises à jour d'e-books déjà achetés" }) @IsBoolean()
  ebookUpdates: boolean;

  @ApiProperty({ description: 'Nouveautés et offres (consentement)' }) @IsBoolean()
  marketing: boolean;
}

class DeleteAccountDto {
  @ApiProperty() @IsString() @MaxLength(128)
  password: string;
}

@ApiTags('Compte')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, marketingConsent: u.marketingConsent };
  }

  @Patch()
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    await this.prisma.user.update({ where: { id: user.id }, data: { name: dto.name?.trim() } });
    return this.me(user);
  }

  @Put('password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Changer de mot de passe (ferme les autres sessions)' })
  async password(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.passwordHash || !(await argon2.verify(u.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Mot de passe actuel incorrect.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(dto.newPassword, { type: argon2.argon2id }) } });
    await this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  @Get('notifications')
  async notifications(@CurrentUser() user: AuthUser) {
    const p = await this.prisma.notificationPref.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    return { orders: true, ebookUpdates: p.ebookUpdates, marketing: p.marketing };
  }

  @Put('notifications')
  async setNotifications(@CurrentUser() user: AuthUser, @Body() dto: NotificationsDto) {
    await this.prisma.notificationPref.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...dto },
      update: dto,
    });
    // Le consentement marketing est horodaté (RGPD).
    await this.prisma.user.update({ where: { id: user.id }, data: { marketingConsent: dto.marketing, marketingConsentAt: new Date() } });
    return this.notifications(user);
  }

  @Get('devices')
  devices(@CurrentUser() user: AuthUser) {
    return this.prisma.device.findMany({
      where: { userId: user.id },
      select: { id: true, label: true, platform: true, lastSeenAt: true, createdAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  @Delete('devices/:id')
  @HttpCode(204)
  @ApiOperation({ summary: "Retirer un appareil : ses sessions sont fermées" })
  async removeDevice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const dev = await this.prisma.device.findFirst({ where: { id, userId: user.id } });
    if (!dev) return;
    await this.prisma.refreshToken.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.device.delete({ where: { id } });
  }

  @Get('export')
  @ApiOperation({ summary: 'Export RGPD de toutes les données du compte' })
  async export(@CurrentUser() user: AuthUser, @Ip() ip: string) {
    const data = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true, email: true, name: true, role: true, createdAt: true, termsAcceptedAt: true,
        marketingConsent: true, marketingConsentAt: true,
        orders: { select: { reference: true, status: true, totalCents: true, currency: true, createdAt: true, paidAt: true, items: { select: { title: true, priceCents: true } } } },
        entitlements: { select: { grantedAt: true, revokedAt: true, ebook: { select: { title: true } } } },
        progress: { select: { percent: true, updatedAt: true, ebook: { select: { title: true } } } },
        devices: { select: { label: true, platform: true, createdAt: true, lastSeenAt: true } },
        notificationPref: { select: { ebookUpdates: true, marketing: true } },
      },
    });
    await this.audit.log({ actorId: user.id, action: 'user.export', targetType: 'user', targetId: user.id, ip });
    return { exportedAt: new Date(), ...data };
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer le compte : anonymisation, commandes conservées (obligation comptable)' })
  async remove(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto, @Ip() ip: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.passwordHash || !(await argon2.verify(u.passwordHash, dto.password))) {
      throw new BadRequestException('Mot de passe incorrect.');
    }
    await anonymizeUser(this.prisma, user.id);
    await this.audit.log({ actorId: user.id, action: 'user.delete', targetType: 'user', targetId: user.id, ip });
  }
}

export async function anonymizeUser(prisma: PrismaService, userId: string) {
  await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { userId } }),
    prisma.passwordReset.deleteMany({ where: { userId } }),
    prisma.device.deleteMany({ where: { userId } }),
    prisma.readingProgress.deleteMany({ where: { userId } }),
    prisma.notificationPref.deleteMany({ where: { userId } }),
    prisma.cart.deleteMany({ where: { userId } }),
    prisma.entitlement.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.user.update({
      where: { id: userId },
      data: { email: null, name: 'Compte supprimé', passwordHash: null, status: 'DELETED', deletedAt: new Date(), marketingConsent: false },
    }),
  ]);
}
