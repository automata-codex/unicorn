import { defineConfig } from 'drizzle-kit';

// Drizzle Kit is used for local schema introspection and diffing only.
// Flyway owns the migrations that actually get applied to the database;
// the `out` directory below is never read at runtime.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
