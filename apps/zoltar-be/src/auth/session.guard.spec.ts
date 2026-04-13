import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { SessionGuard } from './session.guard';

function mockAuthService() {
  return {
    validateSession: vi.fn(),
    getUserById: vi.fn(),
  };
}

function mockConfigService(nodeEnv: string) {
  return {
    get: vi.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined)),
  };
}

function mockExecutionContext(headers: Record<string, string> = {}) {
  const request: any = { headers, user: undefined };
  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any,
    request,
  };
}

const validUser = { id: 'u1', email: 'a@x.com', name: 'Alice' };

describe('SessionGuard', () => {
  let authService: ReturnType<typeof mockAuthService>;
  let guard: SessionGuard;

  beforeEach(() => {
    authService = mockAuthService();
    guard = new SessionGuard(
      authService as any,
      mockConfigService('development') as any,
    );
  });

  it('extracts token from authjs.session-token cookie', async () => {
    authService.validateSession.mockResolvedValue(validUser);
    const { context, request } = mockExecutionContext({
      cookie: 'other=val; authjs.session-token=tok123; extra=x',
    });

    await guard.canActivate(context);

    expect(authService.validateSession).toHaveBeenCalledWith('tok123');
    expect(request.user).toEqual(validUser);
  });

  it('falls back to Authorization: Bearer header in development', async () => {
    authService.validateSession.mockResolvedValue(validUser);
    const { context, request } = mockExecutionContext({
      authorization: 'Bearer bearer-tok',
    });

    await guard.canActivate(context);

    expect(authService.validateSession).toHaveBeenCalledWith('bearer-tok');
    expect(request.user).toEqual(validUser);
  });

  it('ignores Authorization: Bearer header in production', async () => {
    const prodGuard = new SessionGuard(
      authService as any,
      mockConfigService('production') as any,
    );
    authService.validateSession.mockResolvedValue(validUser);
    const { context } = mockExecutionContext({
      authorization: 'Bearer bearer-tok',
    });

    await expect(prodGuard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(authService.validateSession).not.toHaveBeenCalled();
  });

  it('prefers cookie over Bearer header', async () => {
    authService.validateSession.mockResolvedValue(validUser);
    const { context } = mockExecutionContext({
      cookie: 'authjs.session-token=cookie-tok',
      authorization: 'Bearer bearer-tok',
    });

    await guard.canActivate(context);

    expect(authService.validateSession).toHaveBeenCalledWith('cookie-tok');
  });

  it('throws UnauthorizedException when no token is present', async () => {
    const { context } = mockExecutionContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(authService.validateSession).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when session is invalid', async () => {
    authService.validateSession.mockResolvedValue(null);
    const { context } = mockExecutionContext({
      cookie: 'authjs.session-token=bad-tok',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
