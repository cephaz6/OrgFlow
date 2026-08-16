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

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
