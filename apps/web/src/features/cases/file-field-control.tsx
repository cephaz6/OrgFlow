'use client';

import { Button } from '@orgflow/ui';
import type { FormField } from '@orgflow/types';
import { useRef, useState } from 'react';

import {
  confirmAttachmentUpload,
  presignAttachmentUpload,
  uploadToPresignedUrl,
} from './api-client';
import { AttachmentList, formatBytes } from './attachment-list';
import type { AttachmentResponse } from './types';

type FileField = Extract<FormField, { type: 'file' }>;

type Status = { kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; message: string };

export interface FileFieldControlProps {
  field: FileField;
  caseId: string;
  controlId: string;
  described: string | undefined;
  attachments: AttachmentResponse[];
  onAttachmentAdded: (attachment: AttachmentResponse) => void;
  onAttachmentRemoved: (attachmentId: string) => void;
}

// A fast, friendly rejection before spending a round trip on one the API
// would refuse anyway (apps/api/src/routes/attachments.ts validates the
// same three things server-side; this is convenience, not the boundary).
function precheck(field: FileField, file: File): string | null {
  const validation = field.validation;
  if (validation?.maxSizeBytes !== undefined && file.size > validation.maxSizeBytes) {
    return `This file is larger than the ${formatBytes(validation.maxSizeBytes)} limit.`;
  }
  if (
    validation?.acceptedMimeTypes &&
    validation.acceptedMimeTypes.length > 0 &&
    !validation.acceptedMimeTypes.includes(file.type)
  ) {
    return `${field.label} does not accept files of this type.`;
  }
  return null;
}

export function FileFieldControl({
  field,
  caseId,
  controlId,
  described,
  attachments,
  onAttachmentAdded,
  onAttachmentRemoved,
}: FileFieldControlProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const maxFiles = field.validation?.maxFiles;
  const atLimit = maxFiles !== undefined && attachments.length >= maxFiles;

  async function handleFile(file: File) {
    const rejection =
      precheck(field, file) ??
      (atLimit
        ? `${field.label} accepts at most ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`
        : null);
    if (rejection) {
      setStatus({ kind: 'failed', message: rejection });
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      return;
    }

    setStatus({ kind: 'working' });
    try {
      const presigned = await presignAttachmentUpload({
        caseId,
        fieldKey: field.key,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      await uploadToPresignedUrl(presigned.upload, file);
      const confirmed = await confirmAttachmentUpload(presigned.attachment.attachmentId);

      onAttachmentAdded(confirmed);
      setStatus({ kind: 'idle' });
      setAnnouncement(`${file.name} uploaded.`);
    } catch (err) {
      setStatus({
        kind: 'failed',
        message: err instanceof Error ? err.message : 'The file could not be uploaded. Try again.',
      });
    } finally {
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <AttachmentList
        attachments={attachments}
        onDeleted={(attachmentId) => {
          onAttachmentRemoved(attachmentId);
          setAnnouncement('File removed.');
        }}
      />

      {!atLimit ? (
        <div className="flex items-center gap-3">
          {/* The visible trigger is a real button, not a second <label>: the
              field already has one (rendered by FieldInput, htmlFor this
              same input id), and a second label wrapping the input here
              would give it two conflicting accessible names instead of
              one. The button just forwards the click to the hidden input. */}
          <Button
            type="button"
            variant="outline"
            disabled={status.kind === 'working'}
            onClick={() => inputRef.current?.click()}
          >
            {status.kind === 'working' ? 'Uploading...' : 'Choose a file'}
          </Button>
          <input
            ref={inputRef}
            id={controlId}
            type="file"
            className="sr-only"
            aria-describedby={described}
            disabled={status.kind === 'working'}
            {...(field.validation?.acceptedMimeTypes
              ? { accept: field.validation.acceptedMimeTypes.join(',') }
              : {})}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFile(file);
              }
            }}
          />
        </div>
      ) : null}

      {status.kind === 'failed' ? (
        <p role="alert" className="text-sm text-destructive-subtle-foreground">
          {status.message}
        </p>
      ) : null}

      {/* GOV-STANDARDS.md §6.3: an asynchronous status change ("File
          uploaded") is announced, not only shown, since nothing else on
          this screen moves focus or otherwise signals that anything
          happened. */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
