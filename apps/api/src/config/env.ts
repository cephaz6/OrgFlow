import { z } from 'zod';

// ADR-0001: process.env is read only here, and only inside this directory
// (enforced by eslint.config.mjs). Everything else receives config as an
// explicit argument. Grows as later steps add what they actually need;
// this is not the full .env.example inventory yet.
const envSchema = z.object({
  ORGFLOW_ENV: z.enum(['local', 'development', 'staging', 'production']),
  ORGFLOW_API_PORT: z.coerce.number().int().positive(),
  ORGFLOW_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ORGFLOW_DATABASE_URL: z.string().min(1),
  ORGFLOW_MONGODB_URI: z.string().min(1),
  ORGFLOW_WEB_URL: z.string().url(),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    console.error('Invalid environment configuration:', fieldErrors);
    process.exit(1);
  }

  return Object.freeze(parsed.data);
}
