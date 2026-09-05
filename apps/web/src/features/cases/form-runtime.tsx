'use client';

import type { OrganisationRole, ProcessDefinitionDocument } from '@orgflow/types';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAnnouncer, LiveRegion } from '../../lib/announcer';
import { createDraftCase, patchCaseValues, resubmitCase, submitCase } from './api-client';
import {
  describeVisibilityChange,
  describeVisible,
  type VisibleShape,
} from './announce-visibility';
import { FieldInput } from './field-input';
import type { AttachmentResponse, CaseResponse } from './types';
import { isStaticField, UNSUPPORTED_TYPES, validateFields } from './validate';
import { visibleFields, visibleSections, type VisibilityInput } from './visibility';

// The three ways a form is filled in. Amending a returned case, and
// continuing a draft, both run the same runtime as a new request because
// it is the same form, evaluated against the same pinned document, with
// the same conditional visibility. The difference is only where the
// answers go (and, for 'draft', whether a case needs creating at all), so
// it is a discriminator rather than a second component.
export type FormRuntimeMode =
  | { kind: 'new'; definitionId: string; definitionKey: string }
  | { kind: 'draft'; caseId: string }
  | { kind: 'resubmit'; caseId: string; reference: string };

export interface FormRuntimeProps {
  mode: FormRuntimeMode;
  document: ProcessDefinitionDocument;
  initialValues?: Record<string, unknown>;
  initialAttachments?: AttachmentResponse[];
  userId: string;
  roles: OrganisationRole[];
}

type Status =
  | { kind: 'editing' }
  | { kind: 'submitting' }
  | { kind: 'submitted'; result: CaseResponse }
  | { kind: 'failed'; message: string };

export function FormRuntime({
  mode,
  document,
  initialValues,
  initialAttachments,
  userId,
  roles,
}: FormRuntimeProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(initialValues ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: 'editing' });
  const [attachments, setAttachments] = useState<AttachmentResponse[]>(initialAttachments ?? []);
  const summaryRef = useRef<HTMLDivElement>(null);

  // A `file` field needs a caseId to attach to before the form can ever
  // collect one, but a genuinely new request has no case yet: PRD.md §8.2
  // still pins the version at submission, so the draft this creates has no
  // answers on it, only an id for uploads to reference while the requester
  // fills the rest in. resubmit and draft modes already have a real case,
  // so there is nothing to create.
  const [caseId, setCaseId] = useState<string | null>(
    mode.kind === 'resubmit' || mode.kind === 'draft' ? mode.caseId : null,
  );
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftRequested = useRef(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (mode.kind !== 'new' || draftRequested.current) {
      return;
    }
    draftRequested.current = true;

    createDraftCase(mode.definitionId)
      .then((created) => setCaseId(created.caseId))
      .catch((err: unknown) =>
        setDraftError(
          err instanceof Error ? err.message : 'This request could not be started. Try again.',
        ),
      );
    // mode.definitionId is fixed for the component's lifetime; this must
    // run exactly once, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Conditional visibility is a change of context a sighted requester sees
  // and a screen reader user does not, so it is spoken. The comparison is
  // against a ref rather than state: it must not itself cause a render, and
  // the first pass establishes a baseline without announcing the form's own
  // opening shape as though it had just appeared.
  const { announcedText, announce } = useAnnouncer();
  const previousShape = useRef<VisibleShape | null>(null);
  const currentShape = describeVisible(sections, (section) => visibleFields(section, visibility));

  useEffect(() => {
    const previous = previousShape.current;
    previousShape.current = currentShape;
    if (previous === null) {
      return;
    }
    const message = describeVisibilityChange(previous, currentShape);
    if (message !== null) {
      announce(message);
    }
    // currentShape is rebuilt every render by design; values is what can
    // actually change it, and depending on the object would announce on
    // every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, announce]);

  // A visible, required question the runtime cannot collect. Submitting
  // would produce a case with an unanswered mandatory field, so the form
  // says so plainly instead.
  const blockedBy = answerable.filter(
    (field) => UNSUPPORTED_TYPES.has(field.type) && field.required,
  );

  const attachmentCountByFieldKey = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const attachment of attachments) {
      counts[attachment.fieldKey] = (counts[attachment.fieldKey] ?? 0) + 1;
    }
    return counts;
  }, [attachments]);

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

  function addAttachment(attachment: AttachmentResponse) {
    setAttachments((current) => [...current, attachment]);
    setErrors((current) => {
      if (!(attachment.fieldKey in current)) {
        return current;
      }
      const { [attachment.fieldKey]: _removed, ...rest } = current;
      return rest;
    });
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.attachmentId !== attachmentId),
    );
  }

  // Only visible answers are ever sent, to submit or to save: a value
  // typed into a field a later answer hid would otherwise be stored on the
  // case and shown to an approver (or resumed into) as though it had been
  // asked for.
  function visiblePayload(): Record<string, unknown> {
    const visibleKeys = new Set(answerable.map((field) => field.key));
    return Object.fromEntries(Object.entries(values).filter(([key]) => visibleKeys.has(key)));
  }

  // Saves whatever has been answered so far, unvalidated, and leaves the
  // case a draft: PRD.md's own point of a draft is that it can be
  // incomplete, so this deliberately does not run validateFields the way
  // onSubmit does. Only offered for 'new' and 'draft' modes; resubmitting a
  // returned case is treated as one atomic action, not something to leave
  // half-done.
  async function onSaveDraft() {
    if (mode.kind === 'resubmit' || caseId === null) {
      return;
    }

    setSavingDraft(true);
    setDraftSaveError(null);
    try {
      await patchCaseValues(caseId, visiblePayload());
      router.push('/cases');
    } catch (err) {
      setDraftSaveError(
        err instanceof Error ? err.message : 'This request could not be saved. Try again.',
      );
    } finally {
      setSavingDraft(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const found = validateFields(answerable, values, now, attachmentCountByFieldKey);
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
      const payload = visiblePayload();

      if (mode.kind === 'new' || mode.kind === 'draft') {
        // caseId is guaranteed by this point: the form below does not
        // render, and so cannot be submitted, until the draft exists.
        await patchCaseValues(caseId!, payload);
        const result = await submitCase(caseId!);
        setStatus({ kind: 'submitted', result });
        return;
      }

      await resubmitCase(mode.caseId, payload);
      // Back to the case, refreshed from the server rather than patched
      // locally, so the status, the timeline and the actions all come from
      // one render and cannot disagree with each other.
      router.push(`/cases/${mode.caseId}`);
      router.refresh();
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
            <Button asChild>
              <Link href={`/cases/${status.result.caseId}`}>Track this request</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/cases">All my requests</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (draftError) {
    return <Alert variant="destructive">{draftError}</Alert>;
  }

  if (caseId === null) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Preparing your request...
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
                caseId={caseId}
                attachments={attachments}
                onAttachmentAdded={addAttachment}
                onAttachmentRemoved={removeAttachment}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      <LiveRegion text={announcedText} />

      {status.kind === 'failed' ? <Alert variant="destructive">{status.message}</Alert> : null}
      {draftSaveError ? <Alert variant="destructive">{draftSaveError}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={status.kind === 'submitting' || blockedBy.length > 0}>
          {status.kind === 'submitting'
            ? 'Submitting...'
            : mode.kind === 'resubmit'
              ? 'Resubmit request'
              : 'Submit request'}
        </Button>
        {mode.kind === 'new' || mode.kind === 'draft' ? (
          <Button
            type="button"
            variant="outline"
            disabled={status.kind === 'submitting' || savingDraft}
            onClick={() => void onSaveDraft()}
          >
            {savingDraft ? 'Saving...' : 'Save and finish later'}
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link
            href={
              mode.kind === 'new' ? `/catalogue/${mode.definitionKey}` : `/cases/${mode.caseId}`
            }
          >
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}
