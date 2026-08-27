import Script from 'next/script';

import { THEME_STORAGE_KEY } from './storage-key';

// Rendered directly in <head>, before <body> and before React hydrates, so
// an explicit theme choice applies before the first paint rather than
// flashing the default (dark) and then switching. This is the one place a
// blocking inline script is the right tool: nothing else runs early enough
// to set the data-theme attribute before the browser paints the page.
//
// Deliberately does nothing when there is no stored choice: packages/ui's
// tokens.css already resolves "no explicit choice" to the system
// preference (or dark, if the browser reports neither) entirely in CSS, so
// the "system" state needs no JavaScript at all. This script's only job is
// making an *explicit* choice win before paint.
const SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (err) {
    // Storage can throw in a locked-down browsing context (private mode
    // with storage disabled, a restrictive iframe sandbox); the system
    // default from tokens.css is a safe, correct fallback either way.
  }
})();
`;

// next/script's beforeInteractive strategy, not a plain <script> tag: Next
// moves this markup itself rather than letting React's hydration diff the
// element, which is exactly why a raw <script dangerouslySetInnerHTML>
// here produced a spurious hydration-mismatch warning on every load (the
// server and client copies were always identical; React was comparing an
// element Next had already relocated). beforeInteractive is also the
// documented way to guarantee the script runs before hydration at all,
// which matters here since the whole point is setting data-theme before
// the browser paints.
export function ThemeScript() {
  return (
    // The lint rule this triggers predates the App Router: it only knows
    // about pages/_document.js, but placing a beforeInteractive script in
    // the root layout's <head> is the App Router's own documented
    // replacement for that file, and is exactly what this component does.
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document
    <Script id="theme-script" strategy="beforeInteractive">
      {SCRIPT}
    </Script>
  );
}
