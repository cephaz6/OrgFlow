import type { Request, Response } from 'express';

// Short-lived, holds the OIDC state/nonce/PKCE verifier between /auth/login
// and /auth/callback. Not the session cookie: no user identity here, just
// enough to survive the redirect round-trip and be checked for integrity.
const FLOW_COOKIE_NAME = 'orgflow_oidc_flow';
const FLOW_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

export interface OidcFlowState {
  state: string;
  nonce: string;
  codeVerifier: string;
  email: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
}

export function setFlowCookie(res: Response, flow: OidcFlowState, secure: boolean): void {
  res.cookie(FLOW_COOKIE_NAME, Buffer.from(JSON.stringify(flow)).toString('base64url'), {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: FLOW_COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

export function readFlowCookie(req: Request): OidcFlowState | null {
  const raw = req.cookies?.[FLOW_COOKIE_NAME] as string | undefined;
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as OidcFlowState;
  } catch {
    return null;
  }
}

export function clearFlowCookie(res: Response): void {
  res.clearCookie(FLOW_COOKIE_NAME, { path: '/' });
}
