import type { OrganisationRole, SessionClaims } from '@orgflow/types';
import { EncryptJWT, jwtDecrypt } from 'jose';

// ADR-0010: stateless, encrypted, signed session, no server-side store.
// "dir" key management with A256GCM needs a raw 32-byte key; the secret is
// generated as 64 hex characters (openssl rand -hex 32), which decodes to
// exactly that.
const ALG = 'dir';
const ENC = 'A256GCM';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = 'orgflow_session';

function getKey(secret: string): Uint8Array {
  return new Uint8Array(Buffer.from(secret, 'hex'));
}

export function buildSessionClaims(
  userId: string,
  organisationId: string | null,
  roles: OrganisationRole[],
): SessionClaims {
  const now = new Date();
  return {
    userId,
    organisationId,
    roles,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_DURATION_MS).toISOString(),
  };
}

export async function createSessionToken(secret: string, claims: SessionClaims): Promise<string> {
  const key = getKey(secret);
  const issuedAtSeconds = Math.floor(new Date(claims.issuedAt).getTime() / 1000);
  const expiresAtSeconds = Math.floor(new Date(claims.expiresAt).getTime() / 1000);

  return new EncryptJWT({
    organisationId: claims.organisationId,
    roles: claims.roles,
  })
    .setProtectedHeader({ alg: ALG, enc: ENC })
    .setSubject(claims.userId)
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(expiresAtSeconds)
    .encrypt(key);
}

// Absolute expiry only, via the JWT exp claim, verified automatically by
// jwtDecrypt. Idle-timeout enforcement (GOV-STANDARDS.md §6.2) would need a
// sliding re-issue-on-activity mechanism; deferred as a follow-up, not
// silently skipped.
export async function verifySessionToken(
  secret: string,
  token: string,
): Promise<SessionClaims | null> {
  try {
    const key = getKey(secret);
    const { payload } = await jwtDecrypt(token, key);

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }

    return {
      userId: payload.sub,
      organisationId: (payload.organisationId as string | null | undefined) ?? null,
      roles: (payload.roles as OrganisationRole[] | undefined) ?? [],
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}
