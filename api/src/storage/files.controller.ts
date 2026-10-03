import { Controller, ForbiddenException, Get, NotFoundException, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma.service.js';
import { StorageService } from './storage.service.js';

/** Sert les fichiers du pilote local. Accès uniquement par URL signée et non expirée. */
@ApiExcludeController()
@Controller('files')
export class FilesController {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('signed')
  async signed(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('d') disposition: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (!key || !sig || !this.storage.verify(key, Number(exp), disposition ?? '', sig)) {
      throw new ForbiddenException('Lien expiré ou invalide.');
    }
    const file = await this.prisma.file.findUnique({ where: { storageKey: key } });
    if (!file) throw new NotFoundException();
    const body = await this.storage.get(key);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', disposition || 'inline');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.send(body);
  }
}
