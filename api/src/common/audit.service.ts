import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

/** Journal des actions sensibles (CDC §11, critère CA-27). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry) {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        meta: (entry.meta ?? undefined) as object | undefined,
        ip: entry.ip,
      },
    });
  }
}
