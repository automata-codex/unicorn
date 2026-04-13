import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { AuthService } from '@uv/auth-core';
import type { AuthUser } from '@uv/auth-core';

interface AuthenticatedRequest extends FastifyRequest {
  user: AuthUser;
}

const SESSION_COOKIE = 'authjs.session-token';

@Injectable()
export class SessionGuard implements CanActivate {
  private readonly isDev: boolean;

  constructor(
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    this.isDev = configService.get('NODE_ENV') === 'development';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    const user = await this.authService.validateSession(token);
    if (!user) {
      throw new UnauthorizedException();
    }

    request.user = user;
    return true;
  }

  private extractToken(request: FastifyRequest): string | null {
    // 1. Try the session cookie
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const token = this.parseCookie(cookieHeader, SESSION_COOKIE);
      if (token) return token;
    }

    // 2. Fall back to Authorization: Bearer <token> (local dev only — curl/testing convenience)
    if (this.isDev) {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7);
      }
    }

    return null;
  }

  private parseCookie(header: string, name: string): string | null {
    const prefix = `${name}=`;
    const parts = header.split(';');
    for (const part of parts) {
      const trimmed = part.trimStart();
      if (trimmed.startsWith(prefix)) {
        return trimmed.slice(prefix.length);
      }
    }
    return null;
  }
}
