import rateLimit, { type Options } from 'express-rate-limit';

// GOV-STANDARDS.md §6.4: rate-limit authentication, submission and file
// upload endpoints. No such routes exist yet; this is the shared factory
// those routes will use once they do.
export function createRateLimiter(overrides: Partial<Options> = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    ...overrides,
  });
}
