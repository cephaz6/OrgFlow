import { NextResponse, type NextRequest } from 'next/server';

import { config as env, isDevelopment } from './config/env';

// GOV-STANDARDS.md §11 requires a Content-Security-Policy carrying neither
// 'unsafe-inline' nor 'unsafe-eval'. Until this file existed, apps/web sent
// no security headers at all: the CSP that matters is the one on the HTML
// document, and the only policy in the system was helmet's default on the
// API's JSON responses, where it constrains almost nothing.
//
// A nonce is the only way to satisfy "no 'unsafe-inline'" while Next.js
// still injects its own inline bootstrap and hydration scripts. Next reads
// the nonce back out of the Content-Security-Policy header on the request
// and applies it to every framework script it emits, which is why the
// header is set on the request as well as the response.
//
// The usual objection to nonces is that they force dynamic rendering and so
// give up static optimisation. That cost is already paid here and is not a
// new trade-off: app/(app)/layout.tsx awaits getSession(), which reads
// cookies(), so every authenticated page is dynamically rendered already.
// See ADR-0046.

// React reconstructs server-side error stacks in the browser using eval, and
// the dev overlay injects styles directly, so development needs two
// relaxations that production must never carry. isDevelopment comes from the
// config module because ADR-0001 confines process.env to that directory.

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const directives = [
    `default-src 'self'`,
    // 'strict-dynamic' lets a nonced bundle load the chunks it imports
    // without every chunk URL having to be enumerated here.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    // fonts.googleapis.com is named because ADR-0021 loads Google Sans Flex
    // with a plain <link> to Google's CSS API rather than through
    // next/font/google, the one deliberate exception to CLAUDE.md §5.2's
    // self-hosting rule. Without it the body typeface silently falls back to
    // the system sans in production, which is exactly what happened the
    // first time this policy was tested against a production build.
    `style-src 'self' ${isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`} https://fonts.googleapis.com`,
    // The stylesheet above resolves to font files on a second origin.
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' blob: data:`,
    // The browser talks to the API on its own origin, which is a different
    // origin in every environment, so it has to be named.
    `connect-src 'self' ${apiOrigin()}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];

  const csp = directives.join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', csp);
  // Headers helmet already sets on the API, which had no counterpart here.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  // Sent only over HTTPS: a browser ignores HSTS on a plain-HTTP response
  // anyway, and asserting it in local development would pin localhost to
  // HTTPS in the developer's browser for a year.
  if (request.nextUrl.protocol === 'https:') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  return response;
}

// connect-src has to name the API's origin rather than its full base URL:
// a CSP source expression matches scheme, host and port, and a path on it
// would silently never match. config/env.ts has already validated this as a
// URL at boot (ADR-0001), so parsing it here cannot fail.
function apiOrigin(): string {
  return new URL(env.NEXT_PUBLIC_ORGFLOW_API_URL).origin;
}

export const config = {
  matcher: [
    {
      // Static assets and image optimisation output carry no inline script
      // and need no nonce, and a fresh nonce per prefetch would only defeat
      // the router's caching.
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
