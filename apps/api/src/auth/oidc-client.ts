import * as client from 'openid-client';

export interface OidcProviderConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
}

// ADR-0002: generic OIDC via openid-client, not a Google-specific SDK, so a
// second provider is configuration, not a code change.
export async function discoverOidc(provider: OidcProviderConfig): Promise<client.Configuration> {
  return client.discovery(new URL(provider.issuerUrl), provider.clientId, {
    client_secret: provider.clientSecret,
  });
}

export function buildAuthorizationRequestUrl(
  config: client.Configuration,
  params: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
    hostedDomain?: string;
  },
): URL {
  return client.buildAuthorizationUrl(config, {
    redirect_uri: params.redirectUri,
    scope: 'openid email profile',
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    ...(params.hostedDomain ? { hd: params.hostedDomain } : {}),
  });
}

export { client };
