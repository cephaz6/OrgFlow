import { z } from 'zod';

// ADR-0001: process.env is read only here, inside an application's config
// module, and enforced by eslint.config.mjs. Everything else receives
// configuration as an explicit argument.
function optionalString(inner: z.ZodString) {
  return z.preprocess((value) => (value === '' ? undefined : value), inner.optional());
}

const envSchema = z.object({
  ORGFLOW_ENV: z.enum(['local', 'development', 'staging', 'production']),
  ORGFLOW_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ORGFLOW_DATABASE_URL: z.string().min(1),
  // Notification links point at the web app, not the API (PRD.md §14.2:
  // every notification links directly to the actionable screen).
  ORGFLOW_WEB_URL: z.string().url(),
  ORGFLOW_AWS_REGION: z.string().min(1),
  ORGFLOW_AWS_ENDPOINT: optionalString(z.string().url()),
  // The queue this worker consumes. Blank means there is nothing to poll,
  // which the entry point reports and exits on rather than idling silently.
  ORGFLOW_NOTIFICATIONS_QUEUE_URL: optionalString(z.string().url()),
  // Blank means email goes to the dummy sender. The Phase 1 plan makes the
  // SNS and SQS path real but stops short of delivering real mail, so this
  // is expected to be blank locally; the worker logs which sender it built.
  ORGFLOW_SES_FROM_ADDRESS: optionalString(z.string().email()),
});

export type WorkerConfig = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(): WorkerConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    console.error('Invalid environment configuration:', fieldErrors);
    process.exit(1);
  }

  return Object.freeze(parsed.data);
}
