import type { NextFunction, Request, Response } from 'express';

// PRD.md §11.10: errors follow RFC 7807 problem details.
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export class HttpProblemError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail?: string,
    public readonly type: string = 'about:blank',
  ) {
    super(title);
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  const problem: ProblemDetails = {
    type: 'about:blank',
    title: 'Not Found',
    status: 404,
    instance: req.originalUrl,
  };
  res.status(404).contentType('application/problem+json').json(problem);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const isProblem = err instanceof HttpProblemError;
  const status = isProblem ? err.status : 500;

  const problem: ProblemDetails = {
    type: isProblem ? err.type : 'about:blank',
    title: isProblem ? err.title : 'Internal Server Error',
    status,
    instance: req.originalUrl,
    ...(isProblem && err.detail ? { detail: err.detail } : {}),
  };

  req.log?.error({ err }, 'request failed');
  res.status(status).contentType('application/problem+json').json(problem);
}
