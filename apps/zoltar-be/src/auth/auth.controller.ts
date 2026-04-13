import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { EmailService } from '@uv/service-interfaces';
import type { AuthUser } from '@uv/auth-core';
import { DB_TOKEN } from '../db/db.provider';
import type { Db } from '../db/db.provider';
import * as schema from '../db/schema';
import { SessionGuard } from './session.guard';
import { CurrentUser } from './current-user.decorator';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days
const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  @Post('magic-link')
  async magicLink(
    @Body() body: { email: string },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const email = body.email.toLowerCase().trim();

    // Look up or create user
    const existing = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    let userId: string;
    if (existing[0]) {
      userId = existing[0].id;
    } else {
      userId = randomBytes(16).toString('hex');
      await this.db.insert(schema.users).values({ id: userId, email });
    }

    // Generate and hash token
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = hashToken(rawToken);
    const expires = new Date(Date.now() + TOKEN_MAX_AGE_MS);

    // Upsert verification token — delete any existing for this email first
    await this.db
      .delete(schema.verificationTokens)
      .where(eq(schema.verificationTokens.identifier, email));
    await this.db.insert(schema.verificationTokens).values({
      identifier: email,
      token: hashedToken,
      expires,
    });

    // Send magic link email — link points to the backend verify endpoint,
    // which sets the session cookie and redirects to the frontend.
    const apiUrl = this.config.get<string>('PUBLIC_API_URL');
    const magicUrl = `${apiUrl}/api/v1/auth/verify?token=${rawToken}&email=${encodeURIComponent(email)}`;
    await this.emailService.sendTransactional(
      email,
      'Sign in to Zoltar',
      `<p>Click <a href="${magicUrl}">here</a> to sign in. This link expires in 24 hours.</p>`,
    );

    // 202 — don't reveal whether email exists
    reply.status(202).send();
  }

  @Get('verify')
  async verify(
    @Query('token') rawToken: string,
    @Query('email') email: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const appUrl = this.config.get<string>('PUBLIC_APP_URL');

    if (!rawToken || !email) {
      reply.redirect(`${appUrl}/signin?error=invalid_token`);
      return;
    }

    const hashedToken = hashToken(rawToken);
    const decodedEmail = decodeURIComponent(email).toLowerCase().trim();

    // Look up verification token
    const rows = await this.db
      .select()
      .from(schema.verificationTokens)
      .where(
        and(
          eq(schema.verificationTokens.identifier, decodedEmail),
          eq(schema.verificationTokens.token, hashedToken),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row || row.expires < new Date()) {
      reply.redirect(`${appUrl}/signin?error=invalid_token`);
      return;
    }

    // Delete token (single-use)
    await this.db
      .delete(schema.verificationTokens)
      .where(
        and(
          eq(schema.verificationTokens.identifier, decodedEmail),
          eq(schema.verificationTokens.token, hashedToken),
        ),
      );

    // Find user
    const userRows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, decodedEmail))
      .limit(1);

    if (!userRows[0]) {
      reply.redirect(`${appUrl}/signin?error=invalid_token`);
      return;
    }

    // Create session
    const sessionToken = randomBytes(32).toString('hex');
    const sessionExpires = new Date(Date.now() + SESSION_MAX_AGE_S * 1000);
    await this.db.insert(schema.authSessions).values({
      sessionToken,
      userId: userRows[0].id,
      expires: sessionExpires,
    });

    // Set cookie and redirect
    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN');
    reply.header(
      'Set-Cookie',
      `authjs.session-token=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=${cookieDomain}; Max-Age=${SESSION_MAX_AGE_S}`,
    );
    reply.status(302).header('Location', `${appUrl}/campaigns`).send();
  }

  @Post('signout')
  @UseGuards(SessionGuard)
  async signout(
    @CurrentUser() user: AuthUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Delete all sessions for this user (simple approach)
    await this.db
      .delete(schema.authSessions)
      .where(eq(schema.authSessions.userId, user.id));

    const cookieDomain = this.config.get<string>('COOKIE_DOMAIN');
    reply
      .header(
        'Set-Cookie',
        `authjs.session-token=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=${cookieDomain}; Max-Age=0`,
      )
      .status(204)
      .send();
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
