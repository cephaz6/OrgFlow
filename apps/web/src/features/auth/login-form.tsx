'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Input, Label } from '@orgflow/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { config } from '../../config/env';

const emailSchema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('Enter a valid email address.'),
});

type EmailFormValues = z.infer<typeof emailSchema>;

interface ProvidersResponse {
  provider: { type: 'oidc'; displayName: string; issuerUrl: string } | null;
}

type FormStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'no-provider' }
  | { kind: 'error'; message: string };

export function LoginForm() {
  const [status, setStatus] = useState<FormStatus>({ kind: 'idle' });
  const [devLoginStatus, setDevLoginStatus] = useState<FormStatus>({ kind: 'idle' });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailFormValues>({ resolver: zodResolver(emailSchema) });

  async function onSubmit(values: EmailFormValues) {
    setStatus({ kind: 'submitting' });

    try {
      const response = await fetch(
        `${config.NEXT_PUBLIC_ORGFLOW_API_URL}/auth/providers?email=${encodeURIComponent(values.email)}`,
      );

      if (!response.ok) {
        setStatus({ kind: 'error', message: 'Could not reach OrgFlow. Try again in a moment.' });
        return;
      }

      const body = (await response.json()) as ProvidersResponse;

      if (!body.provider) {
        setStatus({ kind: 'no-provider' });
        return;
      }

      // Full navigation, not fetch: the API sets the session cookie as part
      // of a server-side redirect chain through the identity provider.
      window.location.href = `${config.NEXT_PUBLIC_ORGFLOW_API_URL}/auth/login?email=${encodeURIComponent(values.email)}`;
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach OrgFlow. Try again in a moment.' });
    }
  }

  async function onDevLogin() {
    setDevLoginStatus({ kind: 'submitting' });

    try {
      const response = await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}/auth/dev-login`, {
        method: 'POST',
        credentials: 'include',
      });

      if (response.status === 404) {
        setDevLoginStatus({
          kind: 'error',
          message: 'The seeded development login is not available in this environment.',
        });
        return;
      }

      if (!response.ok) {
        setDevLoginStatus({ kind: 'error', message: 'Sign-in failed. Try again in a moment.' });
        return;
      }

      window.location.href = '/';
    } catch {
      setDevLoginStatus({
        kind: 'error',
        message: 'Could not reach OrgFlow. Try again in a moment.',
      });
    }
  }

  const isSubmitting = status.kind === 'submitting';

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        noValidate
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email ? (
            <p id="email-error" role="alert" className="text-sm text-destructive">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        {status.kind === 'no-provider' ? (
          <Alert variant="destructive">
            No identity provider is configured for this email address. Contact your organisation
            administrator, or ask them to invite you.
          </Alert>
        ) : null}

        {status.kind === 'error' ? <Alert variant="destructive">{status.message}</Alert> : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Checking...' : 'Continue'}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void onDevLogin()}
          disabled={devLoginStatus.kind === 'submitting'}
        >
          {devLoginStatus.kind === 'submitting'
            ? 'Signing in...'
            : 'Continue with the seeded development account'}
        </Button>
        {devLoginStatus.kind === 'error' ? (
          <Alert variant="destructive">{devLoginStatus.message}</Alert>
        ) : null}
      </div>
    </div>
  );
}
