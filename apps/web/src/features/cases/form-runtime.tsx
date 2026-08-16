'use client';

import type { OrganisationRole, ProcessDefinitionDocument } from '@orgflow/types';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { submitNewCase, type CaseResponse } from './api';
import { FieldInput } from './field-input';
import { isStaticField, UNSUPPORTED_TYPES, validateFields } from './validate';
import { visibleFields, visibleSections, type VisibilityInput } from './visibility';

export interface FormRuntimeProps {
  definitionId: string;
  definitionKey: string;
  document: ProcessDefinitionDocument;
  userId: string;
  roles: OrganisationRole[];
}

type Status =
  | { kind: 'editing' }
  | { kind: 'submitting' }
  | { kind: 'submitted'; result: CaseResponse }
  | { kind: 'failed'; message: string };

export function FormRuntime({
  definitionId,
  definitionKey,
  document,
  userId,
  roles,
}: FormRuntimeProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: 'editing' });
  const summaryRef = useRef<HTMLDivElement>(null);

  // Counts failed attempts rather than watching `errors`, so that a second
  // submission returning the same problems still moves focus back to the
  // summary. Focus cannot be moved inline in the submit handler: at that
  // point setErrors has only been queued, the summary is not in the
  // document yet, and the ref is still null. That was the first
  // implementation, and it silently did nothing.
  const [failedAttempts, setFailedAttempts] = useState(0);

  useEffect(() => {
    if (failedAttempts > 0) {
      summaryRef.current?.focus();
    }
  }, [failedAttempts]);

  // Fixed for the lifetime of the form rather than read per keystroke.
  // A date bound of "today" must not shift underneath a half-completed
  // answer, and a condition on $now must not re-evaluate on every render.
  const [now] = useState(() => new Date());

  const visibility: VisibilityInput = { values, roles, userId, now: now.toISOString() };

  const sections = useMemo(
    () => visibleSections(document.form.sections, visibility),
    // visibility is rebuilt each render; values is what actually changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document.form.sections, values, roles, userId],
  );

  const answerable = sections.flatMap((section) =>
    visibleFields(section, visibility).filter((field) => !isStaticField(field)),
  );

  // A visible, required question the runtime cannot collect. Submitting
  // would produce a case with an unanswered mandatory field, so the form
  // says so plainly instead.
  const blockedBy = answerable.filter(
    (field) => UNSUPPORTED_TYPES.has(field.type) && field.required,
  );

  function setValue(key: string, value: unknown) {
    setValues((current) => ({ ...current, [key]: value }));
    // Clears this field's error only. Revalidating everything on each
    // keystroke would flag questions the requester has not reached yet.
    setErrors((current) => {
      if (!(key in current)) {
        return current;
      }
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const found = validateFields(answerable, values, now);
    setErrors(found);

    if (Object.keys(found).length > 0) {
      // Focus moves to the summary rather than to the first bad field, so
      // that the whole list is announced and the requester learns how many
      // problems there are before being dropped into one of them. The
      // effect above does the moving, once the summary exists.
      setFailedAttempts((count) => count + 1);
      return;
    }

    setStatus({ kind: 'submitting' });

    try {
      // Only visible answers are sent. A value typed into a field that a
      // later answer hid would otherwise be stored on the case and shown to
      // an approver as though it had been asked for.
      const visibleKeys = new Set(answerable.map((field) => field.key));
      const payload = Object.fromEntries(
        Object.entries(values).filter(([key]) => visibleKeys.has(key)),
      );

      const result = await submitNewCase(definitionId, payload);
      setStatus({ kind: 'submitted', result });
    } catch (err) {
      setStatus({
        kind: 'failed',
        message:
          err instanceof Error ? err.message : 'The request could not be submitted. Try again.',
      });
    }
  }

  if (status.kind === 'submitted') {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-4 p-6">
          <span className="flex items-center gap-2 text-success-subtle-foreground">
            <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Request submitted</h2>
          </span>
          <p className="text-sm text-muted-foreground">
            Your request is now with the first approver. Keep this reference; it identifies the
            request everywhere in OrgFlow.
          </p>
          <p className="font-mono text-2xl">{status.result.reference}</p>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/catalogue">Back to the catalogue</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/cases/new/${definitionKey}`}>Start another</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const errorEntries = Object.entries(errors);

  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => void onSubmit(event)} noValidate>
      {errorEntries.length > 0 ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-destructive bg-destructive-subtle p-4 text-destructive-subtle-foreground"
        >
          <h2 className="text-sm font-semibold">
            There{' '}
            {errorEntries.length === 1 ? 'is 1 problem' : `are ${errorEntries.length} problems`}{' '}
            with this request
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-sm">
            {errorEntries.map(([key, message]) => (
              <li key={key}>
                <a href={`#${key}`} className="underline">
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blockedBy.length > 0 ? (
        <Alert variant="destructive">
          This request asks for {blockedBy.map((field) => field.label).join(', ')}, which OrgFlow
          cannot collect yet. It cannot be submitted until that is available.
        </Alert>
      ) : null}

      {sections.map((section) => (
        <Card key={section.key}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            {section.description ? (
              <p className="text-sm text-muted-foreground">{section.description}</p>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {visibleFields(section, visibility).map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={values[field.key]}
                error={errors[field.key]}
                onChange={(value) => setValue(field.key, value)}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      {status.kind === 'failed' ? <Alert variant="destructive">{status.message}</Alert> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status.kind === 'submitting' || blockedBy.length > 0}>
          {status.kind === 'submitting' ? 'Submitting...' : 'Submit request'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/catalogue/${definitionKey}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
