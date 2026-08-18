import type { z } from 'zod';

import { HttpProblemError } from '../middleware/error-handler.js';

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new HttpProblemError(400, 'Bad Request', detail);
  }
  return parsed.data;
}
