// RFC 7807, which the API returns for every error (see
// apps/api/src/middleware/error-handler.ts).
export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | null;

  constructor(status: number, problem: ProblemDetails | null) {
    super(problem?.detail ?? problem?.title ?? `The request failed with status ${status}.`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

export async function toApiError(response: Response): Promise<ApiError> {
  // A problem body is the contract, but an error can also come from
  // somewhere before the handler (a proxy, a crash), so parsing has to be
  // allowed to fail without replacing the real status with a parse error.
  try {
    const problem = (await response.json()) as ProblemDetails;
    return new ApiError(response.status, problem);
  } catch {
    return new ApiError(response.status, null);
  }
}
