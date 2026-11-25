/**
 * What every scene shares: element helpers, easing, colour roles, self-measurement and the contract
 * between a scene and whatever runs it.
 *
 * A scene module exports one `build` function and nothing else. Two runtimes call it: `start` below,
 * for the deterministic renderer (window.__DATA in; window.seek(t), window.measure(), window.LANGD
 * and window.KLAR out), and `web.ts`, for a page on a website. Neither changes how the scene draws.
 */
import type { Box, FaceSource, Hex, Layer, Measurement, SceneData, TextMeasure, Tokens, TypeRole } from "./types.ts";

declare global {
  interface Window {
    __DATA?: SceneData;
    __RENDER?: boolean;
    seek: (t: number) => void;
    measure: () => Measurement;
    LANGD: number;
    KLAR: boolean;
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

export const px = (n: number): string => `${String(n)}px`;
export const num = (n: number): string => String(n);

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const clamp01 = (x: number): number => clamp(x, 0, 1);
/** Progress of an event that starts at `start` and lasts `duration` seconds, 0..1. */
export const phase = (t: number, start: number, duration: number): number => clamp01((t - start) / duration);
export const expoOut = (x: number): number => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
export const inOut = (x: number): number => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

export function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export function html(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function typeStyle(el: HTMLElement, role: TypeRole, sizePx: number): void {
  el.style.fontFamily = `"${role.family}"`;
  el.style.fontWeight = String(role.weight);
  el.style.fontSize = px(sizePx);
  el.style.letterSpacing = `${num(role.tracking)}em`;
  el.style.lineHeight = String(role.leading);
}

export function colourOf(data: SceneData, role: keyof Layer): Hex {
  const name = data.layer[role];
  const hex = data.tokens.colour[name];
  if (hex === undefined) throw new Error(`layer role ${role} names unknown colour ${name}`);
  return hex;
}

/** Fade and lift an element in, from `start`, over 0.9 s. */
export function fadeIn(el: HTMLElement, t: number, start: number, liftPx: number): void {
  const e = expoOut(phase(t, start, 0.9));
  el.style.opacity = String(e);
  el.style.transform = `translateY(${px((1 - e) * liftPx)})`;
}

/** Width of the widest rendered line in an element, from its text nodes' line fragments. */
export function widestLine(el: Element): number {
  const lines = new Map<number, { left: number; right: number }>();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width === 0) continue;
      const key = Math.round(r.top + r.height / 2);
      const line = lines.get(key);
      lines.set(key, line === undefined ? { left: r.left, right: r.right } : { left: Math.min(line.left, r.left), right: Math.max(line.right, r.right) });
    }
  }
  return Math.max(0, ...[...lines.values()].map((l) => l.right - l.left));
}

/**
 * Share of the column a shrunk headline aims for. Type does not scale exactly with its size, so a
 * headline set to the column's full width can come out a pixel wider and break a line it did not need to.
 */
export const FIT = 0.97;

/** Largest body size, in hundredths of the canvas's short side: past it the deck reads as a second headline. */
export const BODY_MAX_U = 2.8;

/**
 * The designer's headline lines, with any line wider than `width` broken between words. Measured in
 * `host`, so the break follows the type it is set in. A single word wider than the column stays whole.
 */
export function wrapLines(lines: readonly string[], width: number, host: HTMLElement): string[] {
  const probe = html("span", "line");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  host.append(probe);
  const fits = (text: string): boolean => {
    probe.textContent = text;
    return probe.getBoundingClientRect().width <= width;
  };
  const wrapped = lines.flatMap((line) => {
    const out: string[] = [];
    let current = "";
    for (const word of line.split(/\s+/).filter((w) => w !== "")) {
      const tried = current === "" ? word : `${current} ${word}`;
      if (current !== "" && !fits(tried)) {
        out.push(current);
        current = word;
      } else {
        current = tried;
      }
    }
    return current === "" ? out : [...out, current];
  });
  probe.remove();
  return wrapped;
}

/** The layout facts of one text element, as the checks need them. */
export function measureText(el: HTMLElement, name: string, rightEdge: number): TextMeasure {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const role = el.dataset["role"] ?? el.parentElement?.dataset["role"] ?? "label";
  const overflowing = [el, ...Array.from(el.querySelectorAll<HTMLElement>(".mask"))].some(
    (node) => node.scrollWidth > node.clientWidth + 1,
  );
  return {
    role: role === "display" || role === "body" ? role : "label",
    name,
    box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    lineW: widestLine(el),
    fontSizePx: parseFloat(style.fontSize),
    fontWeight: parseFloat(style.fontWeight),
    colour: style.color,
    overflow: overflowing || rect.right > rightEdge + 0.5,
    fontFamily: style.fontFamily,
    opacity: effectiveOpacity(el),
  };
}

function effectiveOpacity(el: HTMLElement): number {
  let opacity = 1;
  for (let node: HTMLElement | null = el; node !== null; node = node.parentElement) {
    opacity *= parseFloat(getComputedStyle(node).opacity);
  }
  return opacity;
}

export function loadedFonts(): string[] {
  const families: string[] = [];
  document.fonts.forEach((face) => {
    if (face.status === "loaded") families.push(face.family.replaceAll('"', ""));
  });
  return families;
}

/** Give the artwork a text alternative when the photograph has one; otherwise hide it from assistive technology. */
export function describeArt(art: SVGSVGElement, alt: string | undefined): void {
  if (alt === undefined) {
    art.setAttribute("aria-hidden", "true");
    return;
  }
  art.setAttribute("role", "img");
  art.setAttribute("aria-label", alt);
}

/** Side of the grain tile in CSS pixels. */
const GRAIN_TILE = 256;

/**
 * Film grain for a live page: one fixed, seamless noise tile, drawn once by the browser and then only
 * composited. Same noise recipe as the rendered film, without the per-frame filter.
 */
export function grainLayer(opacity: number): HTMLElement {
  const tile =
    `<svg xmlns="${SVG_NS}" width="${num(GRAIN_TILE)}" height="${num(GRAIN_TILE)}">` +
    `<filter id="g" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="1" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
  const layer = html("div", "grain");
  layer.setAttribute("aria-hidden", "true");
  layer.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(tile)}")`;
  layer.style.backgroundSize = `${px(GRAIN_TILE)} ${px(GRAIN_TILE)}`;
  layer.style.opacity = String(opacity);
  layer.style.mixBlendMode = "overlay";
  return layer;
}

/** Place an image so it covers `region`, keeping the focus point as central as the crop allows. */
export function coverImage(image: SVGImageElement, region: Box, focus: SceneData["focus"], aspect: number, zoom: number): void {
  const width = Math.max(region.w, region.h * aspect) * zoom;
  const height = width / aspect;
  const x = Math.min(region.x, Math.max(region.x + region.w - width, region.x + region.w / 2 - focus.x * width));
  const y = Math.min(region.y, Math.max(region.y + region.h - height, region.y + region.h / 2 - focus.y * height));
  image.setAttribute("x", num(x));
  image.setAttribute("y", num(y));
  image.setAttribute("width", num(width));
  image.setAttribute("height", num(height));
}

export interface Built {
  readonly seek: (t: number) => void;
  readonly measure: () => Measurement;
}

/** Build the composition into `host` for `data`. Every visual state afterwards is a pure function of t. */
export type Build = (data: SceneData, imageAspect: number, host: HTMLElement) => Built;

/** Faces this page added itself, by URL and family: each file is added once, however often a scene is built. */
const addedFaces = new Map<string, FontFace>();
const faceKey = (source: FaceSource): string => `${source.url}\n${source.family}`;

function addFace(source: FaceSource): FontFace {
  const known = addedFaces.get(faceKey(source));
  if (known !== undefined) return known;
  const face = new FontFace(source.family, `url("${encodeURI(source.url)}")`, { weight: source.weight, display: "block" });
  document.fonts.add(face);
  addedFaces.set(faceKey(source), face);
  return face;
}

/** Wait for every type role's face, so text is laid out and measured with the real fonts. */
export async function loadTypeFaces(tokens: Tokens): Promise<void> {
  await Promise.all((tokens.faces ?? []).map(async (source) => {
    const face = addFace(source);
    try {
      await face.load();
    } catch {
      // Forgotten, so the next build tries the file again instead of the failed face.
      document.fonts.delete(face);
      addedFaces.delete(faceKey(source));
      throw new Error(`The font ${source.family} could not be loaded. Upload it again as WOFF2, WOFF, TTF or OTF.`);
    }
  }));
  // Fonts load lazily; request each role explicitly.
  await Promise.all(
    Object.values(tokens.type).map((role) => document.fonts.load(`${num(role.weight)} 40px "${role.family}"`)),
  );
  await document.fonts.ready;
}

/** Load an image by URL, so a scene can be built with its real proportions. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => { resolve(probe); };
    probe.onerror = () => { reject(new Error(`image did not load: ${url}`)); };
    probe.src = url;
  });
}

/** The renderer's runtime: load fonts and the image, build the scene, expose the render contract. */
export async function start(build: Build): Promise<void> {
  const data = window.__DATA;
  if (data === undefined) throw new Error("window.__DATA is missing");
  await loadTypeFaces(data.tokens);
  const image = await loadImage(data.imageUrl);
  const scene = build(data, image.naturalWidth / image.naturalHeight, document.body);
  window.LANGD = data.lengthS;
  window.seek = scene.seek;
  window.measure = scene.measure;
  scene.seek(window.__RENDER === true ? window.LANGD : 0);
  window.KLAR = true;
  if (window.__RENDER !== true) {
    const begin = performance.now();
    const loop = (): void => {
      scene.seek(((performance.now() - begin) / 1000) % (window.LANGD + 1.5));
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
