import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthController } from './auth.controller';

function mockEmailService() {
  return {
    sendTransactional: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AuthController', () => {
  let controller: AuthController;
  let emailService: ReturnType<typeof mockEmailService>;

  beforeEach(() => {
    emailService = mockEmailService();
    controller = new AuthController(emailService as any);
  });

  describe('POST /auth/send-verification', () => {
    it('sends a magic link email via EmailService', async () => {
      await controller.sendVerification({
        email: 'user@example.com',
        url: 'https://app.zoltar.local/verify?token=abc',
      });

      expect(emailService.sendTransactional).toHaveBeenCalledWith(
        'user@example.com',
        'Sign in to Zoltar',
        expect.stringContaining('https://app.zoltar.local/verify?token=abc'),
      );
    });
  });
});
