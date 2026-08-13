import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

const HEADER_NAME = 'x-correlation-id';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

// PRD.md §11.10: accepted and propagated; generated when absent.
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER_NAME);
  const id = incoming && incoming.length > 0 ? incoming : randomUUID();
  req.correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  next();
}
