import { Body, Controller, Post } from '@nestjs/common';
import { EmailService } from '@uv/service-interfaces';

@Controller('auth')
export class AuthController {
  constructor(private readonly emailService: EmailService) {}

  // Internal-only endpoint — called by SvelteKit server-side to deliver magic link emails.
  // Must only be reachable from the Docker internal network (not exposed through Traefik).
  @Post('send-verification')
  async sendVerification(
    @Body() body: { email: string; url: string },
  ): Promise<void> {
    await this.emailService.sendTransactional(
      body.email,
      'Sign in to Zoltar',
      `<p>Click <a href="${body.url}">here</a> to sign in. This link expires in 24 hours.</p>`,
    );
  }
}
