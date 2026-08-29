'use client';

import { Alert, Button, EmptyState, Label, Textarea } from '@orgflow/ui';
import { Lock, MessageSquare } from 'lucide-react';
import { useState } from 'react';

import { formatDateTime } from '../../lib/format';
import { postCaseComment } from './api-client';
import type { CaseCommentEntry } from './types';

export interface CaseCommentsProps {
  caseId: string;
  initialComments: CaseCommentEntry[];
  // Whether this viewer is entitled to post an internal, requester-hidden
  // note (apps/api's canSeeInternalComments): computed server-side from
  // roles and task history, not from anything this component could know
  // on its own. The API enforces this regardless; hiding the control when
  // it would only fail keeps the UI honest about what it can do.
  canPostInternalNote: boolean;
}

export function CaseComments({ caseId, initialComments, canPostInternalNote }: CaseCommentsProps) {
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await postCaseComment(caseId, {
        body,
        visibility: internal ? 'approvers' : 'all',
      });
      setComments((current) => [...current, created]);
      setBody('');
      setInternal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That comment could not be posted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      {comments.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No comments yet"
          description="Ask a question or leave a note below."
        />
      ) : (
        <ol className="flex flex-col gap-4">
          {comments.map((comment) => (
            <li key={comment.commentId} className="rounded-lg border border-border p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{comment.authorDisplayName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(comment.createdAt)}
                </span>
              </div>
              {comment.visibility === 'approvers' ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock aria-hidden="true" className="h-3 w-3" />
                  Internal note, not visible to the requester
                </p>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))}
        </ol>
      )}

      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <Label htmlFor="new-comment">Add a comment</Label>
        <Textarea
          id="new-comment"
          required
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Ask a question, or add context for whoever picks this up next."
        />

        {canPostInternalNote ? (
          <div className="flex items-center gap-2">
            <input
              id="internal-note"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={internal}
              onChange={(event) => setInternal(event.target.checked)}
            />
            <Label htmlFor="internal-note" className="text-sm font-normal">
              Internal note (hidden from the requester)
            </Label>
          </div>
        ) : null}

        <Button type="submit" disabled={busy} className="self-start">
          {busy ? 'Posting...' : 'Post comment'}
        </Button>
      </form>
    </div>
  );
}
