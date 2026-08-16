'use client';

import { useCallback, useRef, useState } from 'react';

// The gap flagged when this feature was scoped: nothing in apps/web uses
// aria-live anywhere yet, so drag-and-drop and its keyboard equivalent
// (CLAUDE.md §3) had no existing pattern to reuse. A polite, atomic live
// region that re-announces even the same text twice in a row (drag one
// field up, then immediately drag it back down: both need to be heard),
// which is why the message is suffixed with a discardable counter rather
// than being set directly.
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
