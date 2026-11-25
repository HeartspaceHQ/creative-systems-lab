/**
 * Technical checks. Two tiers:
 *  - source checks run on the design source before anything renders (exact, from tokens);
 *  - render checks run on what the scene measured about itself after layout.
 * Neither tier judges whether the design is good. That is the human review.
 */
import type { Box, Hex, ImageRegion, Layer, Measurement, TextMeasure, Tokens } from "./types.ts";

export interface Check {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: Hex): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2.x contrast ratio between two relative luminances. */
export function contrastOfLuminance(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG 2.x contrast ratio between two sRGB colours. */
export function contrast(a: Hex, b: Hex): number {
  return contrastOfLuminance(luminance(a), luminance(b));
}

function hex(tokens: Tokens, name: string): Hex {
  const value = tokens.colour[name];
  if (value === undefined) throw new Error(`unknown colour ${name}`);
  return value;
}

/** Every text role in every layer must clear its contrast floor against the ground. */
export function sourceChecks(tokens: Tokens): Check[] {
  const checks: Check[] = [];
  // Every colour sum below reads six hex digits; a short form would give NaN, not an error.
  const malformed = Object.entries(tokens.colour).filter(([, value]) => !/^#[0-9a-f]{6}$/i.test(value));
  checks.push({
    name: "colours are #rrggbb",
    passed: malformed.length === 0,
    detail: malformed.length === 0 ? `${String(Object.keys(tokens.colour).length)} colours` : malformed.map(([k, v]) => `${k} ${v}`).join(", "),
  });
  const pairs: readonly (readonly [keyof Layer, number])[] = [
    ["text", tokens.rules.min_contrast_body],
    ["quiet", tokens.rules.min_contrast_body],
    ["line", tokens.rules.min_contrast_large],
    ["accent", tokens.rules.min_contrast_large],
  ];
  for (const [layerName, layer] of Object.entries(tokens.layers)) {
    for (const [role, floor] of pairs) {
      const ratio = contrast(hex(tokens, layer[role]), hex(tokens, layer.ground));
      checks.push({
        name: `contrast ${layerName}.${role}/ground`,
        passed: ratio >= floor,
        detail: `${layer[role]} on ${layer.ground} ${ratio.toFixed(2)}:1, floor ${floor.toFixed(1)}:1`,
      });
    }
  }
  const { display, body } = tokens.type;
  checks.push({
    name: "type roles distinct",
    passed: display.family !== body.family,
    detail: `display ${display.family}, body ${body.family}`,
  });
  return checks;
}

/** Whether `inner` lies within `outer`, give or take `slack` pixels. */
export const inside = (inner: Box, outer: Box, slack: number): boolean =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.w <= outer.x + outer.w + slack &&
  inner.y + inner.h <= outer.y + outer.h + slack;

export function overlapsImage(box: Box, image: ImageRegion): boolean {
  if (image.kind === "rect") {
    const o = image.box;
    return box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h;
  }
  const nx = Math.max(box.x, Math.min(image.cx, box.x + box.w));
  const ny = Math.max(box.y, Math.min(image.cy, box.y + box.h));
  return (nx - image.cx) ** 2 + (ny - image.cy) ** 2 < image.r ** 2;
}

/** Share of the safe width a headline must fill before a narrow screen excuses a smaller type scale. */
const NARROW_FILL = 0.9;

/** Layout facts measured in the browser after seek(LANGD). */
export function renderChecks(m: Measurement, tokens: Tokens): Check[] {
  const checks: Check[] = [];
  for (const t of m.texts) {
    checks.push({ name: `${t.name} fits its line`, passed: !t.overflow, detail: t.overflow ? "overflows" : "no overflow" });
    checks.push({
      name: `${t.name} inside safe area`,
      passed: inside(t.box, m.safe, 1),
      detail: `box ${t.box.x.toFixed(0)},${t.box.y.toFixed(0)} ${t.box.w.toFixed(0)}×${t.box.h.toFixed(0)}`,
    });
    const under = m.images.filter((image) => overlapsImage(t.box, image));
    if (under.every((image) => image.kind === "rect" && image.stage === true)) {
      if (under.length === 0) checks.push({ name: `${t.name} clear of image`, passed: true, detail: "not on the image" });
    } else {
      checks.push({ name: `${t.name} clear of image`, passed: false, detail: "text sits on an image that is not a stage" });
    }
  }
  const display = m.texts.find((t) => t.role === "display");
  const body = m.texts.find((t) => t.role === "body");
  if (display !== undefined && body !== undefined) {
    const ratio = display.fontSizePx / body.fontSizePx;
    // On a narrow screen the scale can run out of room: the body is at its legibility floor and the
    // headline's widest line already fills the measure. The hierarchy is then as strong as the
    // screen allows, and the check says so rather than demand a headline wider than the screen.
    const atLimit = body.fontSizePx <= tokens.rules.min_body_px && display.lineW >= NARROW_FILL * m.safe.w;
    checks.push({
      name: "type scale display/body",
      passed: ratio >= tokens.rules.display_to_body_min_ratio || atLimit,
      detail: `${ratio.toFixed(2)}, floor ${tokens.rules.display_to_body_min_ratio.toFixed(1)}${
        ratio < tokens.rules.display_to_body_min_ratio && atLimit
          ? `; narrow screen: body at its ${String(tokens.rules.min_body_px)} px floor and the headline's widest line fills ${((display.lineW / m.safe.w) * 100).toFixed(0)} % of the measure`
          : ""
      }`,
    });
  }
  for (const family of new Set(Object.values(tokens.type).map((r) => r.family))) {
    checks.push({
      name: `font loaded: ${family}`,
      passed: m.fontsLoaded.includes(family),
      detail: m.fontsLoaded.includes(family) ? "loaded" : "fallback in use",
    });
  }
  return checks;
}

/** Luminance spread of the pixels behind one text element, measured with the text layer hidden. */
export interface Backdrop {
  readonly name: string;
  /** 5th and 95th percentile relative luminance: the darkest and brightest the text has to hold against. */
  readonly p5: number;
  readonly p95: number;
}

function cssLuminance(colour: string): number {
  const parts = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colour);
  if (parts === null) throw new Error(`cannot read text colour ${colour}`);
  const [r, g, b] = parts.slice(1, 4).map(Number) as [number, number, number];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast of one text against what lies behind it: the worse of the dark and bright ends. */
export interface StageReading {
  readonly name: string;
  readonly role: TextMeasure["role"];
  readonly ratio: number;
  readonly t: number;
}

/**
 * Text that sits on a stage image must stay legible against the real pixels behind it. The ratio is
 * taken against the worse of the darkest and brightest 5 % of the backdrop, so a bright window or a
 * highlight under one word fails the check even when the average looks fine.
 */
export function stageReadings(m: Measurement, backdrops: readonly Backdrop[], t: number): StageReading[] {
  return backdrops.map((backdrop) => {
    const text = m.texts.find((x) => x.name === backdrop.name);
    if (text === undefined) throw new Error(`no measured text named ${backdrop.name}`);
    const own = cssLuminance(text.colour);
    const ratio = Math.min(contrastOfLuminance(own, backdrop.p5), contrastOfLuminance(own, backdrop.p95));
    return { name: text.name, role: text.role, ratio, t };
  });
}

/**
 * One check per text: its worst reading over every sampled frame in which it is fully shown. A film
 * can be legible in its last frame and not on the way there, so the end state alone proves little.
 */
export function stageChecks(readings: readonly StageReading[], tokens: Tokens, expected: readonly string[]): Check[] {
  const worst = new Map<string, StageReading>();
  const frames = new Map<string, number>();
  for (const r of readings) {
    frames.set(r.name, (frames.get(r.name) ?? 0) + 1);
    const current = worst.get(r.name);
    if (current === undefined || r.ratio < current.ratio) worst.set(r.name, r);
  }
  // A text on the stage that was never fully shown at a sample was never measured: that fails.
  const unmeasured = expected.filter((name) => !worst.has(name)).map((name) => ({
    name: `${name} legible on stage`,
    passed: false,
    detail: "no frame where the text was fully shown on the stage, so never measured",
  }));
  return [...[...worst.values()].map((r) => {
    const floor = r.role === "display" ? tokens.rules.min_contrast_large : tokens.rules.min_contrast_body;
    return {
      name: `${r.name} legible on stage`,
      passed: r.ratio >= floor,
      detail: `worst ${r.ratio.toFixed(2)}:1 at ${r.t.toFixed(1)} s over ${String(frames.get(r.name) ?? 0)} frames, floor ${floor.toFixed(1)}`,
    };
  }), ...unmeasured];
}
