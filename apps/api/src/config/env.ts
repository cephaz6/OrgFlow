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
  ORGFLOW_AWS_REGION: z.string().min(1),
  // Points at LocalStack locally; unset in a deployed environment so the
  // SDK resolves the real endpoint itself.
  ORGFLOW_AWS_ENDPOINT: optionalString(z.string().url()),
  // Blank means domain events go to the dummy publisher instead of SNS.
  // Acceptable locally, where the topic may not be provisioned yet; the
  // API logs which one it constructed at boot so the choice is never
  // silent.
  ORGFLOW_EVENTS_TOPIC_ARN: optionalString(z.string().min(1)),
  // ADR-0002: optional locally; blank means /auth/dev-login is the only
  // path in, which the route itself gates to ORGFLOW_ENV=local.
  ORGFLOW_OIDC_ISSUER_URL: optionalString(z.string().url()),
  ORGFLOW_OIDC_CLIENT_ID: optionalString(z.string().min(1)),
  ORGFLOW_OIDC_CLIENT_SECRET: optionalString(z.string().min(1)),
  // Same variable workers/src/config/env.ts reads for outbound notification
  // email; the invitation route is the API process's only outbound email
  // path, and it needs the identical construction-time choice (real SES or
  // the dummy sender) the workers already make.
  ORGFLOW_SES_FROM_ADDRESS: optionalString(z.string().email()),
  // Blank means attachments go to the dummy file store instead of S3:
  // presigned URLs are fabricated and never actually reachable, acceptable
  // locally and in CI where nothing needs to exercise a real upload yet.
  ORGFLOW_S3_BUCKET: optionalString(z.string().min(1)),
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
