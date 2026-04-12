import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuthService, AuthUser } from '@uv/auth-core';
import { DB_TOKEN } from '../db/db.provider';
import type { Db } from '../db/db.provider';
import * as schema from '../db/schema';

@Injectable()
export class AuthJsService extends AuthService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {
    super();
  }

  async validateSession(sessionToken: string): Promise<AuthUser | null> {
    const rows = await this.db
      .select({
        userId: schema.authSessions.userId,
        expires: schema.authSessions.expires,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.authSessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
      .where(eq(schema.authSessions.sessionToken, sessionToken))
      .limit(1);

    const row = rows[0];
    if (!row || row.expires < new Date()) return null;
    return { id: row.userId, email: row.email, name: row.name };
  }

  async getUserById(id: string): Promise<AuthUser | null> {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);

    const u = rows[0];
    if (!u) return null;
    return { id: u.id, email: u.email, name: u.name };
  }
}
