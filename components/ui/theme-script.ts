/**
 * The pre-paint theme script, as a string.
 *
 * Lives in its own server-safe module because the root layout is a Server
 * Component: it cannot import anything marked `"use client"`, and the script
 * must be rendered into the document head as raw HTML rather than executed by
 * React.
 *
 * It has to run BEFORE the first paint. The server cannot know the visitor's
 * theme — that depends on localStorage and on the OS setting, neither of which
 * exists during SSR — so the HTML ships with no `data-theme` attribute and this
 * applies the right one immediately. Doing it in a React effect instead would
 * paint the default theme first and then correct it, which is the exact flash
 * this prevents.
 *
 * Inlined rather than an external file for the same reason: a request for a
 * separate script is a round trip, and the round trip is the flash.
 */
export const APPLY_THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('fastauth-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
    // Marks the document as interactive so the colour transition in
    // globals.css is allowed to run from here on.
    document.documentElement.classList.add('theme-ready');
  } catch (e) {
    // Private browsing can throw on localStorage access. The default theme
    // still applies from the stylesheet, so this is not worth surfacing.
  }
})();
`.trim();
