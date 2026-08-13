import { z } from 'zod';

// .env.example (ADR-0007) leaves unset variables as `FOO=`, which process.env
// surfaces as an empty string, not undefined. An optional schema field must
// treat both the same way, or a blank-but-present variable fails validation
// instead of being treated as absent.
function optionalString(inner: z.ZodString) {
  return z.preprocess((value) => (value === '' ? undefined : value), inner.optional());
}

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
  // ADR-0010: signs and encrypts the session cookie, not a database secret.
  ORGFLOW_SESSION_SECRET: z.string().min(32),
  // ADR-0002: optional locally; blank means /auth/dev-login is the only
  // path in, which the route itself gates to ORGFLOW_ENV=local.
  ORGFLOW_OIDC_ISSUER_URL: optionalString(z.string().url()),
  ORGFLOW_OIDC_CLIENT_ID: optionalString(z.string().min(1)),
  ORGFLOW_OIDC_CLIENT_SECRET: optionalString(z.string().min(1)),
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
