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
