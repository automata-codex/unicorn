import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().int().positive().default(3000),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  AUTH_EMAIL_FROM: z.string().email().default('noreply@zoltar.local'),
  COOKIE_DOMAIN: z.string().default('.zoltar.local'),
  PUBLIC_APP_URL: z.string().url().default('https://app.zoltar.local'),
  PUBLIC_API_URL: z.string().url().default('https://api.zoltar.local'),
  CORS_ORIGINS: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().min(1),
  VOYAGE_API_KEY: z.string().min(1),
  // Must emit 1024-dimensional vectors to match the `rules_chunk.embedding`
  // column. `voyage-4-lite` defaults to 1024; `voyage-3-lite` emits 512 and is
  // not a valid override. See `docs/decisions.md § Embedding model`.
  VOYAGE_EMBED_MODEL: z.string().default('voyage-4-lite'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
