import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from './prisma.service.js';

export type Role = 'CUSTOMER' | 'ADMIN';
export interface AuthUser {
  id: string;
  role: Role;
}
export interface AccessPayload {
  sub: string;
  role: Role;
  did?: string;
}

type AuthedRequest = Request & { user?: AuthUser; deviceId?: string };

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const OPTIONAL_AUTH = 'optionalAuth';
/** La route accepte les visiteurs, mais lit l'utilisateur si un jeton est fourni. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});

export const DeviceId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().deviceId;
});

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

/**
 * Vérifie le jeton d'accès. Le statut du compte est relu en base à chaque requête :
 * un compte suspendu ou supprimé perd l'accès immédiatement, sans attendre l'expiration du jeton.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, [ctx.getHandler(), ctx.getClass()]);
    const token = bearer(req);
    if (!token) {
      if (optional) return true;
      throw new UnauthorizedException('Authentification requise.');
    }
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      if (optional) return true;
      throw new UnauthorizedException('Session expirée.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true, status: true } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Compte inactif.');
    req.user = { id: user.id, role: user.role };
    req.deviceId = payload.did;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('Accès refusé.');
    return true;
  }
}
