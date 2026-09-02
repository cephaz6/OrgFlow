'use client';

import { Alert, Button, Card } from '@orgflow/ui';
import { AlertTriangle, ArrowRight, Copy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ProcessIcon } from '../catalogue/process-icon';
import { cloneTemplate } from './api-client';
import { ScopeBadge } from './scope-badge';
import type { BrowsableTemplate, CloneResult } from './types';

export interface TemplateGridProps {
  templates: BrowsableTemplate[];
  // A plain member may browse the catalogue but not clone from it, matching
  // the API's own gate, so the button is absent rather than present and
  // failing with a 403 when pressed.
  canClone: boolean;
}

type CloneState =
  | { kind: 'idle' }
  | { kind: 'cloning'; templateId: string }
  | { kind: 'done'; result: CloneResult }
  | { kind: 'failed'; message: string };

function WarningList({ result }: { result: CloneResult }) {
  if (result.warnings.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-md border border-warning bg-warning-subtle p-3 text-warning-subtle-foreground">
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle aria-hidden="true" className="h-4 w-4" />
        {result.warnings.length === 1
          ? 'One step needs somebody assigned to it'
          : `${result.warnings.length} steps need somebody assigned to them`}
      </p>
      {/* ADR-0043: the original target is named rather than counted, since
          "this went to a group called finance" is what tells a process
          owner what to put back. */}
      <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-sm">
        {result.warnings.map((warning, index) => (
          <li key={index}>
            <span className="font-medium">{warning.stepName}</span>{' '}
            {warning.reason === 'group'
              ? `went to a group called "${warning.original}"`
              : 'went to one named person'}
            , which does not exist here. It now goes to the requester&apos;s line manager.
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TemplateGrid({ templates, canClone }: TemplateGridProps) {
  const [state, setState] = useState<CloneState>({ kind: 'idle' });

  async function handleClone(templateId: string) {
    setState({ kind: 'cloning', templateId });
    try {
      const result = await cloneTemplate(templateId);
      setState({ kind: 'done', result });
    } catch {
      setState({
        kind: 'failed',
        message: 'That template could not be copied. Please try again.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Announced rather than only rendered: the outcome of cloning
          arrives after a network round trip, so a screen reader user who
          has moved on still hears that it worked and what needs attention. */}
      <div aria-live="polite">
        {state.kind === 'failed' ? <Alert variant="destructive">{state.message}</Alert> : null}
        {state.kind === 'done' ? (
          <Card className="border-primary p-5">
            <p className="text-sm font-medium">
              Copied as &ldquo;{state.result.name}&rdquo;, as a draft in your organisation.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing is published yet. Review it, then publish when you are ready.
            </p>
            <WarningList result={state.result} />
            <Link
              href={`/processes/${state.result.definitionId}`}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open it in the builder
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </Card>
        ) : null}
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <li key={template.templateId}>
            <Card className="flex h-full flex-col gap-3 p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-subtle-foreground">
                  <ProcessIcon name={template.icon} className="h-4 w-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-medium">{template.name}</p>
                  {template.description ? (
                    <p className="text-sm text-muted-foreground">{template.description}</p>
                  ) : null}
                  {template.category ? (
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      {template.category}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <ScopeBadge scope={template.scope} />
                {canClone ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={state.kind === 'cloning'}
                    onClick={() => void handleClone(template.templateId)}
                  >
                    <Copy aria-hidden="true" className="h-4 w-4" />
                    {state.kind === 'cloning' && state.templateId === template.templateId
                      ? 'Copying...'
                      : 'Use this'}
                  </Button>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
