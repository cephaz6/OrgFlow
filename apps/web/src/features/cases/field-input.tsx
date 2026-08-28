'use client';

import type { FormField } from '@orgflow/types';
import { Input, Label, Select, Textarea } from '@orgflow/ui';

import { FileFieldControl } from './file-field-control';
import type { AttachmentResponse } from './types';
import { isStaticField, UNSUPPORTED_TYPES } from './validate';

export interface FieldInputProps {
  field: FormField;
  value: unknown;
  error: string | undefined;
  onChange: (value: unknown) => void;
  // Only read for a `file` field. caseId is guaranteed present by the time
  // any field renders (FormRuntime does not render the form until the
  // draft, or the case being amended, exists), so a `file` field is never
  // asked to render without one.
  caseId?: string | undefined;
  attachments?: AttachmentResponse[] | undefined;
  onAttachmentAdded?: ((attachment: AttachmentResponse) => void) | undefined;
  onAttachmentRemoved?: ((attachmentId: string) => void) | undefined;
}

interface ControlProps extends FieldInputProps {
  controlId: string;
  described: string | undefined;
}

function describedBy(field: FormField, hasError: boolean): string | undefined {
  const ids = [field.hint ? `${field.key}-hint` : null, hasError ? `${field.key}-error` : null];
  const present = ids.filter((id): id is string => id !== null);
  return present.length > 0 ? present.join(' ') : undefined;
}

function inputTypeFor(type: FormField['type']): string {
  switch (type) {
    case 'number':
    case 'currency':
      return 'number';
    case 'date':
      return 'date';
    case 'dateTime':
      return 'datetime-local';
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    default:
      return 'text';
  }
}

// A component at module scope rather than an expression inside FieldInput.
// Building JSX in a closure defined during render makes React remount the
// subtree on every keystroke, which loses focus and the caret position; the
// react-hooks lint rule flags it for exactly that reason.
function FieldControl({
  field,
  value,
  error,
  onChange,
  controlId,
  described,
  caseId,
  attachments,
  onAttachmentAdded,
  onAttachmentRemoved,
}: ControlProps) {
  const invalid = error ? true : undefined;
  const text = value === null || value === undefined ? '' : String(value);

  if (UNSUPPORTED_TYPES.has(field.type)) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        Choosing a person is not available yet, so this cannot be answered here.
      </p>
    );
  }

  switch (field.type) {
    case 'file':
      return (
        <FileFieldControl
          field={field}
          caseId={caseId!}
          controlId={controlId}
          described={described}
          attachments={(attachments ?? []).filter(
            (attachment) => attachment.fieldKey === field.key,
          )}
          onAttachmentAdded={onAttachmentAdded ?? (() => {})}
          onAttachmentRemoved={onAttachmentRemoved ?? (() => {})}
        />
      );

    case 'textarea':
      return (
        <Textarea
          id={controlId}
          value={text}
          aria-describedby={described}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'select':
      return (
        <Select
          id={controlId}
          value={text}
          aria-describedby={described}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose an option</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );

    case 'radio':
      return (
        <div className="flex flex-col gap-2">
          {field.options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={field.key}
                value={option.value}
                checked={value === option.value}
                aria-describedby={described}
                onChange={() => onChange(option.value)}
                className="h-4 w-4 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      );

    case 'multiSelect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-2">
          {field.options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={option.value}
                checked={selected.includes(option.value)}
                aria-describedby={described}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((entry) => entry !== option.value),
                  )
                }
                className="h-4 w-4 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    }

    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            id={controlId}
            type="checkbox"
            checked={value === true}
            aria-describedby={described}
            onChange={(event) => onChange(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {field.label}
        </label>
      );

    default: {
      const inputType = inputTypeFor(field.type);
      return (
        <Input
          id={controlId}
          type={inputType}
          value={text}
          aria-describedby={described}
          aria-invalid={invalid}
          onChange={(event) =>
            onChange(
              inputType === 'number' && event.target.value !== ''
                ? Number(event.target.value)
                : event.target.value,
            )
          }
        />
      );
    }
  }
}

// Not an asterisk alone: a bare * is announced as "star", or not at all,
// depending on the screen reader, so the requirement would be conveyed by a
// visual device carrying no text.
function RequiredMark() {
  return <span className="text-muted-foreground"> (required)</span>;
}

export function FieldInput({
  field,
  value,
  error,
  onChange,
  caseId,
  attachments,
  onAttachmentAdded,
  onAttachmentRemoved,
}: FieldInputProps) {
  if (field.type === 'heading') {
    return <h3 className="pt-2 text-base font-semibold">{field.label}</h3>;
  }

  if (field.type === 'paragraph') {
    return <p className="text-sm text-muted-foreground">{field.label}</p>;
  }

  const described = describedBy(field, Boolean(error));

  const hintAndError = (
    <>
      {field.hint ? (
        <p id={`${field.key}-hint`} className="text-sm text-muted-foreground">
          {field.hint}
        </p>
      ) : null}
      {error ? (
        // role="alert" so the message is announced when it appears, rather
        // than only being found by somebody who navigates back to the field.
        <p
          id={`${field.key}-error`}
          role="alert"
          className="text-sm text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}
    </>
  );

  const control = (
    <FieldControl
      field={field}
      value={value}
      error={error}
      onChange={onChange}
      controlId={field.key}
      described={described}
      caseId={caseId}
      attachments={attachments}
      onAttachmentAdded={onAttachmentAdded}
      onAttachmentRemoved={onAttachmentRemoved}
    />
  );

  // Radio and multiSelect are groups of controls rather than one control, so
  // the question belongs on a <legend>. A <label> can only point at a single
  // input, which would leave the other options unlabelled by the question.
  if (field.type === 'radio' || field.type === 'multiSelect') {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">
          {field.label}
          {field.required ? <RequiredMark /> : null}
        </legend>
        {hintAndError}
        {control}
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* A checkbox carries its own label beside the box, so repeating it
          above would announce the question twice. */}
      {field.type === 'checkbox' ? null : (
        <Label htmlFor={field.key}>
          {field.label}
          {field.required ? <RequiredMark /> : null}
        </Label>
      )}
      {hintAndError}
      {control}
    </div>
  );
}

export { isStaticField };
