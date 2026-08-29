// The shape GET /identity-providers returns (apps/api/src/routes/identity-
// providers.ts's toBody). clientSecretRef is a Secrets Manager ARN, never
// the secret itself (ADR-0007, schema.ts's own column comment); the API
// never holds or returns anything else in that field.
export interface IdentityProviderEntry {
  providerId: string;
  type: 'oidc';
  displayName: string;
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  emailDomains: string[];
  enabled: boolean;
}

export interface CreateIdentityProviderInput {
  displayName: string;
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  emailDomains: string[];
}

export interface UpdateIdentityProviderInput {
  displayName?: string;
  issuerUrl?: string;
  clientId?: string;
  clientSecretRef?: string;
  emailDomains?: string[];
  enabled?: boolean;
}
