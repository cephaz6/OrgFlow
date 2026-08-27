'use client';

import { StatusBadge } from '@orgflow/ui';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { formatDate } from '../../lib/format';
import { deleteAttachment, getAttachmentDownloadUrl } from './api-client';
import type { AttachmentResponse } from './types';

// 1000-based, matching how every OS and browser already displays a file's
// size to this audience, not the 1024-based binary convention the field's
// own maxSizeBytes validation happens to use internally.
export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function scanStatusBadge(status: AttachmentResponse['scanStatus']) {
  switch (status) {
    case 'clean':
      return <StatusBadge tone="success" icon={CheckCircle2} label="Available" />;
    case 'infected':
      return <StatusBadge tone="danger" icon={ShieldAlert} label="Removed: found infected" />;
    case 'error':
      return <StatusBadge tone="warning" icon={AlertTriangle} label="Could not be scanned" />;
    case 'pending':
    default:
      return <StatusBadge tone="neutral" icon={Loader2} label="Scanning" />;
  }
}

export interface AttachmentListProps {
  attachments: AttachmentResponse[];
  // Present only when the viewer may remove one (the uploader, while the
  // case is still editable). Absent renders a read-only list, which is
  // what an approver or a closed case's history always gets.
  onDeleted?: (attachmentId: string) => void;
}

export function AttachmentList({ attachments, onDeleted }: AttachmentListProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (attachments.length === 0) {
    return null;
  }

  async function download(attachment: AttachmentResponse) {
    setError(null);
    try {
      const { downloadUrl } = await getAttachmentDownloadUrl(attachment.attachmentId);
      // A real navigation, not fetch-then-blob: the presigned URL is
      // already a direct link to the object, and the browser's own
      // download handling (Content-Disposition, progress) is exactly what
      // this should use.
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be downloaded.');
    }
  }

  async function remove(attachment: AttachmentResponse) {
    setError(null);
    setBusyId(attachment.attachmentId);
    try {
      await deleteAttachment(attachment.attachmentId);
      onDeleted?.(attachment.attachmentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be removed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-sm text-destructive-subtle-foreground">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {attachments.map((attachment) => (
          <li
            key={attachment.attachmentId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{attachment.filename}</span>
              <span className="text-xs text-muted-foreground">
                {formatBytes(attachment.sizeBytes)} · Added {formatDate(attachment.createdAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {scanStatusBadge(attachment.scanStatus)}
              {attachment.scanStatus === 'clean' ? (
                <button
                  type="button"
                  onClick={() => void download(attachment)}
                  className="text-sm font-medium text-primary underline hover:no-underline"
                >
                  Download
                </button>
              ) : null}
              {onDeleted ? (
                <button
                  type="button"
                  onClick={() => void remove(attachment)}
                  disabled={busyId === attachment.attachmentId}
                  aria-label={`Remove ${attachment.filename}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
