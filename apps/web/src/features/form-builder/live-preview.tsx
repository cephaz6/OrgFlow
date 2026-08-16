'use client';

import type { FormSection } from '@orgflow/types';
import { Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import { useState } from 'react';

// Deep imports rather than the feature barrel (features/cases/index.ts):
// that barrel also re-exports api-server.ts, which pulls in next/headers.
// A 'use client' component importing the barrel would drag that server-only
// chain into the browser bundle, which Next.js refuses to build. Reaching
// past the barrel for exactly these two client-safe modules is the
// established way around it (see features/auth/index.ts's own mix of
// server-only and client-safe exports for the same reason).
import { FieldInput } from '../cases/field-input';
import { visibleFields, visibleSections, type VisibilityInput } from '../cases/visibility';

export interface LivePreviewProps {
  sections: FormSection[];
  userId: string;
}

// Renders the draft through the same evaluator and the same FieldInput the
// case form runtime uses (features/cases), so what a process owner sees
// here is what a requester will actually be asked, conditions included, not
// a second implementation that could quietly disagree. Answers typed here
// exist only in this component's state: nothing is sent anywhere, since
// this is for exercising visibility conditions while building, not for
// producing a real case.
export function LivePreview({ sections, userId }: LivePreviewProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [now] = useState(() => new Date().toISOString());

  const visibility: VisibilityInput = { values, roles: ['member'], userId, now };
  const shownSections = visibleSections(sections, visibility);

  if (shownSections.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nothing to preview yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {shownSections.map((section) => (
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
                error={undefined}
                onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
