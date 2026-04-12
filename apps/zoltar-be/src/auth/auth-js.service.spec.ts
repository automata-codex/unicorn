import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthJsService } from './auth-js.service';

function mockDb() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  // select() starts a new chain each call, so re-bind
  chain.select.mockReturnValue(chain);
  return chain;
}

describe('AuthJsService', () => {
  let db: ReturnType<typeof mockDb>;
  let service: AuthJsService;

  beforeEach(() => {
    db = mockDb();
    service = new AuthJsService(db as any);
  });

  describe('validateSession', () => {
    it('returns null when no matching session exists', async () => {
      db.limit.mockResolvedValue([]);
      const result = await service.validateSession('no-such-token');
      expect(result).toBeNull();
    });

    it('returns null when the session is expired', async () => {
      const pastDate = new Date(Date.now() - 60_000);
      db.limit.mockResolvedValue([
        { userId: 'u1', expires: pastDate, name: 'Alice', email: 'a@x.com' },
      ]);
      const result = await service.validateSession('expired-token');
      expect(result).toBeNull();
    });

    it('returns the user when the session is valid', async () => {
      const futureDate = new Date(Date.now() + 3_600_000);
      db.limit.mockResolvedValue([
        { userId: 'u1', expires: futureDate, name: 'Alice', email: 'a@x.com' },
      ]);
      const result = await service.validateSession('valid-token');
      expect(result).toEqual({ id: 'u1', name: 'Alice', email: 'a@x.com' });
    });
  });

  describe('getUserById', () => {
    it('returns null when user does not exist', async () => {
      db.limit.mockResolvedValue([]);
      const result = await service.getUserById('missing');
      expect(result).toBeNull();
    });

    it('returns the user when found', async () => {
      db.limit.mockResolvedValue([
        { id: 'u1', name: 'Alice', email: 'a@x.com', emailVerified: null, image: null },
      ]);
      const result = await service.getUserById('u1');
      expect(result).toEqual({ id: 'u1', name: 'Alice', email: 'a@x.com' });
    });
  });
});
