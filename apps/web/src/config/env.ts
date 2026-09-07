import { z } from 'zod';

// ADR-0001: process.env is read only here, and only inside this directory
// (enforced by eslint.config.mjs). The NEXT_PUBLIC_ prefix is Next.js's own
// requirement for anything reaching client-bundled code, not a departure
// from the ORGFLOW_ convention; nothing secret may ever carry it.
const envSchema = z.object({
  NEXT_PUBLIC_ORGFLOW_API_URL: z.string().url(),
});

const parsed = envSchema.safeParse({
  NEXT_PUBLIC_ORGFLOW_API_URL: process.env.NEXT_PUBLIC_ORGFLOW_API_URL,
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
  );
}

export const config = Object.freeze(parsed.data);

// Not part of the schema above: NODE_ENV is set by Next.js itself rather
// than supplied by the operator, so there is nothing to validate and a
// missing value is not a misconfiguration. It is read here rather than at
// its point of use only because ADR-0001 confines process.env to this
// directory, and middleware.ts needs it to decide whether the CSP may carry
// the relaxations React's development build requires (ADR-0046).
export const isDevelopment = process.env.NODE_ENV === 'development';
