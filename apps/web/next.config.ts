import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

// Every other app in the monorepo reads the single root .env (ADR-0007);
// Next.js only auto-loads a .env from the app's own directory, and it
// partially executes Server Components at build time, so src/config/env.ts
// must already see NEXT_PUBLIC_ORGFLOW_API_URL by the time this file
// finishes evaluating. In CI and deployed environments there is no root
// .env at all; the real value arrives as a genuine environment variable
// instead, so a missing file here is not an error.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw err;
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@orgflow/ui'],
  // Linting is its own pipeline stage (pnpm run lint), running the full
  // custom flat config; Next's own build-time pass only knows how to
  // detect eslint-config-next, so it would just warn and duplicate work.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
