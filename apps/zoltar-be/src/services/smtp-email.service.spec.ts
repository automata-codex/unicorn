import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmtpEmailService } from './smtp-email.service';

const sendMail = vi.fn().mockResolvedValue({});

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
  createTransport: vi.fn(() => ({ sendMail })),
}));

function mockConfigService(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    SMTP_HOST: 'mailhog',
    SMTP_PORT: 1025,
    AUTH_EMAIL_FROM: 'noreply@zoltar.local',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key]),
  };
}

describe('SmtpEmailService', () => {
  let service: SmtpEmailService;

  beforeEach(() => {
    sendMail.mockClear();
    service = new SmtpEmailService(mockConfigService() as any);
  });

  it('sends an email via the transporter', async () => {
    await service.sendTransactional('user@example.com', 'Hello', '<p>Hi</p>');

    expect(sendMail).toHaveBeenCalledWith({
      from: 'noreply@zoltar.local',
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });
  });
});
