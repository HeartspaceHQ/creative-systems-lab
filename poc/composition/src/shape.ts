/**
 * The layout family of a canvas. Every scene lays out by it, and the web runtime uses it to pick the
 * campaign format, and so the art-directed asset, that a viewport belongs to. One rule for both, so
 * a viewport never gets a layout from one family and a photograph directed for another.
 */
export type Shape = "tall" | "medium" | "wide";

export const SHAPES: readonly Shape[] = ["tall", "medium", "wide"];

/** Width over height from which a canvas is wide. */
const WIDE_FROM = 1.3;
/** Height over width from which a canvas is tall. */
const TALL_FROM = 1.6;

export const shapeOf = (w: number, h: number): Shape => (w / h >= WIDE_FROM ? "wide" : h / w >= TALL_FROM ? "tall" : "medium");

/**
 * The same rule as a CSS media query on the viewport, so a preload picks what the runtime will.
 * The runtime measures the stage, which excludes a classic scrollbar; within about 15 px of an edge,
 * such a desktop may preload one photograph and build with the other. Overlay scrollbars do not.
 */
export function shapeMedia(shapes: ReadonlySet<Shape>): string {
  const wide = `(min-aspect-ratio: ${String(WIDE_FROM * 1000)}/1000)`;
  const tall = `(max-aspect-ratio: 1000/${String(TALL_FROM * 1000)})`;
  const has = (s: Shape): boolean => shapes.has(s);
  if (has("tall") && has("medium") && has("wide")) return "all";
  if (has("tall") && has("medium")) return `not all and ${wide}`;
  if (has("medium") && has("wide")) return `not all and ${tall}`;
  if (has("tall") && has("wide")) return `not all and (1000/${String(TALL_FROM * 1000)} < aspect-ratio < ${String(WIDE_FROM * 1000)}/1000)`;
  if (has("wide")) return wide;
  if (has("tall")) return tall;
  // Medium alone: strictly between the two edges, in range syntax so no ratio falls in a gap.
  return `(1000/${String(TALL_FROM * 1000)} < aspect-ratio < ${String(WIDE_FROM * 1000)}/1000)`;
}
