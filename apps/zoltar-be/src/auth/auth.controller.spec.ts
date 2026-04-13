import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { AuthController } from './auth.controller';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function mockDb() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  };
}

function mockEmailService() {
  return { sendTransactional: vi.fn().mockResolvedValue(undefined) };
}

function mockConfigService() {
  const values: Record<string, string> = {
    PUBLIC_APP_URL: 'https://app.zoltar.local',
    PUBLIC_API_URL: 'https://api.zoltar.local',
    COOKIE_DOMAIN: '.zoltar.local',
  };
  return { get: vi.fn((key: string) => values[key]) };
}

function mockReply() {
  const reply: any = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  };
  return reply;
}

describe('AuthController', () => {
  let db: ReturnType<typeof mockDb>;
  let emailService: ReturnType<typeof mockEmailService>;
  let config: ReturnType<typeof mockConfigService>;
  let controller: AuthController;

  beforeEach(() => {
    db = mockDb();
    emailService = mockEmailService();
    config = mockConfigService();
    controller = new AuthController(db as any, emailService as any, config as any);
  });

  describe('POST /auth/magic-link', () => {
    it('creates user if not found and sends magic link email', async () => {
      db.limit.mockResolvedValue([]); // no existing user
      const reply = mockReply();

      await controller.magicLink({ email: 'New@Example.com' }, reply);

      expect(db.insert).toHaveBeenCalled();
      expect(emailService.sendTransactional).toHaveBeenCalledWith(
        'new@example.com',
        'Sign in to Zoltar',
        expect.stringContaining('https://api.zoltar.local/api/v1/auth/verify?token='),
      );
      expect(reply.status).toHaveBeenCalledWith(202);
    });

    it('uses existing user if found', async () => {
      db.limit.mockResolvedValue([{ id: 'u1', email: 'user@example.com' }]);
      const reply = mockReply();

      await controller.magicLink({ email: 'user@example.com' }, reply);

      expect(emailService.sendTransactional).toHaveBeenCalled();
      expect(reply.status).toHaveBeenCalledWith(202);
    });
  });

  describe('GET /auth/verify', () => {
    it('redirects to signin with error when token is missing', async () => {
      const reply = mockReply();
      await controller.verify('', 'user@example.com', reply);
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://app.zoltar.local/signin?error=invalid_token',
      );
    });

    it('redirects to signin with error when token is not found in DB', async () => {
      db.limit.mockResolvedValue([]); // no matching token
      const reply = mockReply();
      await controller.verify('some-raw-token', 'user@example.com', reply);
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://app.zoltar.local/signin?error=invalid_token',
      );
    });

    it('redirects to signin with error when token is expired', async () => {
      const pastDate = new Date(Date.now() - 60_000);
      db.limit
        .mockResolvedValueOnce([{ identifier: 'user@example.com', token: hashToken('tok'), expires: pastDate }])
      const reply = mockReply();
      await controller.verify('tok', 'user@example.com', reply);
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://app.zoltar.local/signin?error=invalid_token',
      );
    });

    it('creates session, sets cookie, and redirects on valid token', async () => {
      const futureDate = new Date(Date.now() + 3_600_000);
      db.limit
        // verification_token lookup
        .mockResolvedValueOnce([{ identifier: 'user@example.com', token: hashToken('tok'), expires: futureDate }])
        // user lookup
        .mockResolvedValueOnce([{ id: 'u1', email: 'user@example.com' }]);

      const reply = mockReply();
      await controller.verify('tok', 'user@example.com', reply);

      expect(db.delete).toHaveBeenCalled(); // token deleted
      expect(db.insert).toHaveBeenCalled(); // session created
      expect(reply.header).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.stringContaining('authjs.session-token='),
      );
      expect(reply.status).toHaveBeenCalledWith(302);
      expect(reply.header).toHaveBeenCalledWith(
        'Location',
        'https://app.zoltar.local/campaigns',
      );
    });
  });

  describe('POST /auth/signout', () => {
    it('deletes session and clears cookie', async () => {
      const reply = mockReply();
      await controller.signout({ id: 'u1', email: 'a@x.com', name: 'Alice' }, reply);

      expect(db.delete).toHaveBeenCalled();
      expect(reply.header).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.stringContaining('Max-Age=0'),
      );
      expect(reply.status).toHaveBeenCalledWith(204);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user', () => {
      const user = { id: 'u1', email: 'a@x.com', name: 'Alice' };
      expect(controller.me(user)).toEqual(user);
    });
  });
});
