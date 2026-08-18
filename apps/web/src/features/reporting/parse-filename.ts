// Split from api-client.ts, which imports config/env.ts: that module
// validates NEXT_PUBLIC_ORGFLOW_API_URL at import time and throws if it is
// unset, which a plain unit test for this one pure function should not
// have to stub just to run.
export function parseFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }
  const match = /filename="([^"]+)"/.exec(contentDisposition);
  return match?.[1] ?? null;
}
