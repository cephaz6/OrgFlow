'use client';

import { useCallback, useRef, useState } from 'react';

// A polite live region that re-announces even the same text twice in a row
// (drag one field up, then immediately drag it back down: both need to be
// heard), which is why the message is suffixed with a discardable counter
// rather than being set directly.
//
// This began inside the form builder, as the first use of aria-live in
// apps/web, for drag-and-drop and its keyboard equivalent (CLAUDE.md §3).
// It moved here when the case form runtime became the second caller:
// form-builder already imports from cases, so leaving it there would have
// pointed the dependency back on itself.
export function useAnnouncer() {
  const [text, setText] = useState('');
  const counter = useRef(0);

  const announce = useCallback((message: string) => {
    counter.current += 1;
    setText(`${message}${'​'.repeat(counter.current % 2)}`);
  }, []);

  return { announcedText: text, announce };
}

export function LiveRegion({ text }: { text: string }) {
  return (
    <div aria-live="polite" role="status" className="sr-only">
      {text}
    </div>
  );
}
