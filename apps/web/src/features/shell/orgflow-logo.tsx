import { cn } from '@orgflow/ui';

// Transcribed from src/assets/images/orgflow-logo.svg, which stays as the
// design source. Inlined as JSX rather than loaded through <img src> or
// next/image for one reason that decides the whole approach: the asset
// paints itself entirely in `currentColor`, and currentColor can only
// inherit when the SVG is part of this document. Referenced as an image it
// renders in its own document, where the asset's own `color` attribute
// wins, and the logo would be near-black on a near-black page.
//
// Two changes from the file, both deliberate:
//   1. `color="#101418"` is dropped from the <g>. That attribute is what
//      currentColor resolves against, so removing it hands the decision to
//      whatever text colour the surrounding element sets. `text-foreground`
//      then gives a light logo on the dark theme and a dark one on a light
//      theme, from one asset, with nothing to switch. This is what makes
//      the logo ready for the light/dark toggle before that toggle exists.
//   2. The wordmark's font-family becomes the --font-brand token instead
//      of naming Space Grotesk, so no component names a typeface
//      (CLAUDE.md §5.2) and a theme swap can replace it. --font-brand is
//      deliberately separate from --font-display, which headings use: the
//      operator drew this mark in Space Grotesk, and changing the heading
//      typeface should not silently redraw their logo.
//
// If the .svg is redrawn, this file has to be redrawn with it.

export interface LogoProps {
  className?: string;
  // Set when visible text alongside already says "OrgFlow", so the name is
  // not announced twice.
  decorative?: boolean;
}

function labelling(decorative: boolean) {
  return decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': 'OrgFlow' } as const);
}

// The circular glyph alone, cropped from the full lockup. Used where the
// product name is already present as real text, such as beside it in the
// sidebar, so the wordmark would only repeat it.
export function OrgFlowMark({ className, decorative = true }: LogoProps) {
  return (
    <svg
      {...labelling(decorative)}
      viewBox="20 35 180 180"
      fill="none"
      className={cn('h-8 w-8', className)}
    >
      <circle
        cx="110"
        cy="130"
        r="55"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1"
        strokeDasharray="2 8"
      />
      <circle cx="110" cy="130" r="76" stroke="currentColor" strokeOpacity="0.15" strokeWidth="6" />
      <circle
        cx="110"
        cy="130"
        r="76"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray="318.3 159.2"
        transform="rotate(-90 110 130)"
      />
      <circle cx="110" cy="54" r="10" stroke="currentColor" strokeWidth="4" />
      <circle cx="175.8" cy="168" r="10" stroke="currentColor" strokeWidth="4" />
      <circle cx="44.2" cy="168" r="10" fill="currentColor" />
    </svg>
  );
}

// The full lockup, mark plus wordmark. Used where there is no other text
// naming the product, such as the sign-in page.
export function OrgFlowLogo({ className, decorative = false }: LogoProps) {
  return (
    <svg
      {...labelling(decorative)}
      viewBox="0 38 640 184"
      fill="none"
      className={cn('h-10 w-auto', className)}
    >
      <circle
        cx="110"
        cy="130"
        r="55"
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="1"
        strokeDasharray="2 8"
      />
      <circle cx="110" cy="130" r="76" stroke="currentColor" strokeOpacity="0.15" strokeWidth="6" />
      <circle
        cx="110"
        cy="130"
        r="76"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray="318.3 159.2"
        transform="rotate(-90 110 130)"
      />
      <circle cx="110" cy="54" r="10" stroke="currentColor" strokeWidth="4" />
      <circle cx="175.8" cy="168" r="10" stroke="currentColor" strokeWidth="4" />
      <circle cx="44.2" cy="168" r="10" fill="currentColor" />
      <path d="M 198 130 H 230" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <circle cx="236" cy="130" r="3" fill="currentColor" fillOpacity="0.35" />
      <text
        x="262"
        y="130"
        fill="currentColor"
        dominantBaseline="middle"
        fontFamily="var(--font-brand)"
        fontSize="84"
        letterSpacing="-2.1"
      >
        <tspan fontWeight="600">Org</tspan>
        <tspan fontWeight="300">Flow</tspan>
      </text>
      <rect x="264" y="186" width="337" height="3.5" fill="currentColor" fillOpacity="0.14" />
      <rect x="264" y="186" width="105" height="3.5" fill="currentColor" fillOpacity="0.75" />
    </svg>
  );
}
