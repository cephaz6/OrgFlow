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

// A plain <script> tag, not next/script: theme.spec.ts's "applies a stored
// choice before React hydrates, not after" test blocks every Next.js JS
// chunk and proves the theme still applies, which next/script's
// beforeInteractive strategy cannot survive (it relies on Next's own
// runtime to read a queued __next_s entry and execute it, so blocking
// chunks blocks the script too). A raw inline script has no such
// dependency: the browser's HTML parser executes it synchronously as it is
// encountered, before a single byte of JavaScript has to load.
//
// suppressHydrationWarning, not next/script, is the fix for the console
// warning this used to produce: the server- and client-rendered copies of
// this script are always byte-identical, so there is no real mismatch to
// report. The warning was a false positive from Next's App Router
// relocating <head> content before React's hydration diff ever saw it,
// and this prop is exactly what it exists to silence for a case like this.
// The nonce is required, not optional, and is threaded down from the root
// layout rather than read here: Next.js applies its own nonce to the scripts
// it emits, but a hand-authored <script> like this one is invisible to that,
// so under ADR-0046's policy it is refused execution unless it carries the
// nonce itself. Typing it as required means removing it is a type error
// rather than a silent return of the flash this script exists to prevent.
export function ThemeScript({ nonce }: { nonce: string }) {
  return (
    <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: SCRIPT }} />
  );
}
