// Test-only helpers: converts the oklch() values declared in tokens.css to
// a WCAG relative luminance, so a contrast ratio can be asserted against
// the real numbers rather than eyeballed against a screenshot.
//
// Not exported from the package barrel. Nothing at runtime needs this; it
// exists so that tokens.test.ts can hold the palette to WCAG 2.2 AA, which
// CLAUDE.md §3 makes a completion criterion.

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

// OKLCH to linear sRGB, via OKLab. The matrices are Björn Ottosson's,
// as specified in CSS Color 4.
export function oklchToLinearSrgb({
  l: lightness,
  c: chroma,
  h: hue,
}: Oklch): [number, number, number] {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const longRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mediumRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const shortRoot = lightness - 0.0894841775 * a - 1.291485548 * b;

  const long = longRoot ** 3;
  const medium = mediumRoot ** 3;
  const short = shortRoot ** 3;

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
}

// A colour outside the sRGB gamut is clamped by the browser to something
// other than what the token says, which would silently invalidate every
// ratio measured from it.
export function isWithinSrgbGamut(colour: Oklch): boolean {
  return oklchToLinearSrgb(colour).every((channel) => channel >= -0.001 && channel <= 1.001);
}

// WCAG 2.2 relative luminance. The channels are already linear, so the
// specification's sRGB de-gamma step has been done by the conversion above.
export function relativeLuminance(colour: Oklch): number {
  const [red, green, blue] = oklchToLinearSrgb(colour).map((channel) =>
    Math.min(1, Math.max(0, channel)),
  ) as [number, number, number];

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: Oklch, background: Oklch): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const TOKEN_PATTERN = /^\s*(--[a-z0-9-]+)\s*:\s*oklch\(([^)]+)\)\s*;/gim;

// Parses only the oklch() declarations, so --radius and the font stacks
// are ignored rather than needing to be special-cased.
export function parseColourTokens(css: string): Map<string, Oklch> {
  const tokens = new Map<string, Oklch>();

  for (const match of css.matchAll(TOKEN_PATTERN)) {
    const name = match[1]!;
    const parts = match[2]!.trim().split(/\s+/);
    if (parts.length < 3) {
      throw new Error(`Token ${name} does not declare all three oklch components.`);
    }
    tokens.set(name, { l: Number(parts[0]), c: Number(parts[1]), h: Number(parts[2]) });
  }

  return tokens;
}
