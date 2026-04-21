import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

export const DB_TOKEN = 'DB';

export type Db = NodePgDatabase<typeof schema>;

export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export const dbProvider = {
  provide: DB_TOKEN,
  useFactory: (configService: ConfigService): Db => {
    const pool = new Pool({
      connectionString: configService.getOrThrow<string>('DATABASE_URL'),
    });
    return drizzle(pool, { schema });
  },
  inject: [ConfigService],
};
