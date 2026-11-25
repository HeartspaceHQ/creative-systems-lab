/**
 * Cinematic scene: the photograph is the stage, not a box on a page.
 *
 * The film is the morning the copy describes. It opens in the blue dark of a December morning,
 * the low sun arrives through the window and warms the table, and the steeping time runs while the
 * words land. The release date comes last, as on a film poster. Text sits on the image behind a
 * graded scrim; the renderer measures its contrast against the real pixels behind it.
 *
 * Every visual state is a pure function of t; see kit.ts for the contract.
 */
import { clamp, clamp01, colourOf, describeArt, expoOut, fadeIn, BODY_MAX_U, FIT, grainLayer, html, inOut, loadedFonts, measureText, num, phase, px, svg, typeStyle, widestLine, wrapLines, type Build } from "./kit.ts";
import { shapeOf } from "./shape.ts";
import type { Box, Measurement, SceneData } from "./types.ts";

/**
 * Where light enters when the photograph's manifest does not say: upper left, as a window would. A
 * photograph whose light comes from elsewhere records it in its manifest (`light`).
 */
const LIGHT_DEFAULT = { x: 0.12, y: 0.16 };

/**
 * The film the timeline below was directed at. A campaign of another length plays the same beats in
 * proportion, so the credits always land before the end.
 */
const DIRECTED_LENGTH_S = 10;

interface Shot {
  /** Where on the canvas the focus point should land. */
  readonly anchor: { readonly x: number; readonly y: number };
  readonly zoom: number;
  /** How far the camera pushes in over the whole film. */
  readonly push: number;
}

const STORY: Shot = { anchor: { x: 0.44, y: 0.66 }, zoom: 1.12, push: 0.07 };
/** 4:5 is shorter, so the table edge would meet the text: frame a little closer and lower. */
const FEED: Shot = { anchor: { x: 0.44, y: 0.7 }, zoom: 1.26, push: 0.06 };
const LANDSCAPE: Shot = { anchor: { x: 0.28, y: 0.6 }, zoom: 1.22, push: 0.05 };

/**
 * The largest scale the photograph is ever drawn at, relative to covering the canvas: a web page
 * asks the browser for an image source this much wider than the screen.
 */
export function maxZoom(composition: SceneData["composition"]): number {
  return Math.max(...[STORY, FEED, LANDSCAPE].map((s) => baseZoom(s, composition) * (1 + s.push))) * (composition?.zoom ?? 1);
}

/** The shot's own closeness, or none when the composition asks for the whole photograph. */
function baseZoom(shot: Shot, composition: SceneData["composition"]): number {
  return composition?.framing === "whole" ? 1 : shot.zoom;
}

/** Linear mix of two #rrggbb colours; t = 0 gives a, t = 1 gives b. */
function mixHex(a: string, b: string, t: number): string {
  const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** How far the shadows move from the ground toward the layer's warmth as the sun comes up. */
const WARM_SHADOW = 0.42;

const GRAIN_OPACITY = 0.055;

/** How dark the blue night lies over the photograph at the first frame: dark, but the cup reads. */
const NIGHT = 0.72;
/** On a narrow screen the headline grows until its widest line fills this share of the column. */
const NARROW_HEADLINE_FILL = 0.98;

/**
 * The least share of a wide canvas a photograph fills when the whole of it is asked for. A photograph
 * narrower than the canvas then stands in a panel on the left instead of being cut to a band.
 */
const PANEL_MIN = 0.62;
/** Where across the panel the photograph starts to fade into the dark under the column. */
const PANEL_FADE = 0.72;

/** Place the photograph so its focus point lands on `anchor` (on a w × h canvas), always covering `stage`. */
function place(image: SVGImageElement, stage: Box, w: number, h: number, data: SceneData, aspect: number, shot: Shot, zoom: number): Box {
  // Never smaller than covering the stage, whatever the composition's zoom asks for.
  const width = Math.max(stage.w, stage.h * aspect) * Math.max(1, zoom);
  const height = width / aspect;
  const x = clamp(shot.anchor.x * w - data.focus.x * width, stage.x + stage.w - width, stage.x);
  const y = clamp(shot.anchor.y * h - data.focus.y * height, stage.y + stage.h - height, stage.y);
  image.setAttribute("x", num(x));
  image.setAttribute("y", num(y));
  image.setAttribute("width", num(width));
  image.setAttribute("height", num(height));
  return { x, y, w: width, h: height };
}

type Stop = readonly [offset: number, colour: string, opacity: number];

/** Stops in order and inside 0..1. Where measured offsets cross on a short canvas, the later stop wins its place. */
function addStops(el: SVGElement, stops: readonly Stop[]): void {
  let previous = 0;
  for (const [offset, colour, opacity] of stops) {
    previous = Math.min(1, Math.max(previous, offset));
    el.append(svg("stop", { offset: previous, "stop-color": colour, "stop-opacity": opacity }));
  }
}

/** Scenes built so far in this document; SVG ids are document-wide, so each scene numbers its own. */
let scenesBuilt = 0;

function gradient(kind: "linearGradient" | "radialGradient", id: string, attrs: Record<string, string | number>, stops: readonly Stop[]): SVGElement {
  const el = svg(kind, { id, ...attrs });
  addStops(el, stops);
  return el;
}

/**
 * The scrim over a portrait or square canvas, from where the title block ends (`head`) and where
 * the credits begin (`foot`), as fractions of the height. Dark behind every line of text, open over
 * the cup, with eased stops so the dark falls off like light across a room, not at a panel edge.
 */
export function verticalScrim(tall: boolean, head: number, foot: number, ink: string): Stop[] {
  const fall: readonly (readonly [number, number])[] = tall
    ? [[0, 0.94], [head - 0.07, 0.88], [head + 0.01, 0.78], [head + 0.09, 0.38], [head + 0.17, 0.08], [head + 0.23, 0]]
    : [[0, 0.94], [head - 0.13, 0.9], [head + 0.01, 0.86], [head + 0.08, 0.58], [head + 0.16, 0.12], [head + 0.22, 0]];
  const rise: readonly (readonly [number, number])[] = tall
    ? [[foot - 0.115, 0], [foot - 0.025, 0.72], [1, 0.92]]
    : [[foot - 0.136, 0], [foot - 0.026, 0.76], [1, 0.94]];
  // On a short screen the title block's fall-off and the credits' rise overlap. Stops out of order
  // would be clamped into a hard edge, so the scrim takes the darker of the two curves at every stop.
  const offsets = [...new Set([...fall, ...rise].map(([at]) => clamp01(at)))].sort((a, b) => a - b);
  return offsets.map((at) => [at, ink, Math.max(curve(fall, at), curve(rise, at))]);
}

/** A piecewise linear opacity curve at `at`, transparent outside its stops. */
function curve(stops: readonly (readonly [number, number])[], at: number): number {
  for (let i = 1; i < stops.length; i++) {
    const [x0, y0] = stops[i - 1] ?? [0, 0];
    const [x1, y1] = stops[i] ?? [0, 0];
    // Exact at a stop, so a scrim whose curves do not overlap keeps exactly the stops it always had.
    if (at === x1) return y1;
    if (at === x0) return y0;
    if (at > x0 && at < x1) return y0 + ((y1 - y0) * (at - x0)) / (x1 - x0);
  }
  return 0;
}

export const build: Build = (data, imageAspect, host) => {
  const { width: w, height: h } = data.format;
  const { tokens, copy } = data;
  const shape = shapeOf(w, h);
  const landscape = shape === "wide";
  const tall = shape === "tall";
  const composition = data.composition ?? {};
  const framed = landscape ? LANDSCAPE : tall ? STORY : FEED;
  const shot: Shot = { ...framed, zoom: baseZoom(framed, composition) * (composition.zoom ?? 1) };
  const night = composition.night ?? NIGHT;
  const lightAt = data.light ?? LIGHT_DEFAULT;
  const u = Math.min(w, h) / 100;
  const m = tokens.rules.safe_margin_u * u;
  // The safe area: the margin, plus what a screen covers at its edges (a notch, a home indicator).
  const inset = data.inset ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const safe: Box = { x: m + inset.left, y: m + inset.top, w: w - 2 * m - inset.left - inset.right, h: h - 2 * m - inset.top - inset.bottom };
  // A rendered canvas this small would leave the body at its floor and the type scale below its own;
  // a live page has its own rule for narrow screens (below).
  const scaleFloorPx = data.medium === "web" ? 0 : tokens.rules.min_body_px * (tokens.rules.display_to_body_min_ratio + 0.1);
  let displayPx = Math.max(scaleFloorPx, (landscape ? 8.8 : tall ? 10.6 : 9.6) * u * (composition.headline ?? 1));
  // Body follows the headline down to the scale's ratio, but never past a size that reads as body copy on this canvas.
  const bodyOf = (display: number): number =>
    Math.max(tokens.rules.min_body_px, Math.min(display / (tokens.rules.display_to_body_min_ratio + 0.1), BODY_MAX_U * u));
  let bodyPx = bodyOf(displayPx);
  const labelPx = Math.max(13, 1.7 * u);
  const ink = colourOf(data, "ground");
  const paper = colourOf(data, "text");
  const quiet = colourOf(data, "quiet");
  const accent = colourOf(data, "accent");
  const sunCore = colourOf(data, "light");
  const sunFall = colourOf(data, "glow");
  const warmth = colourOf(data, "warmth");
  const length = data.lengthS;
  /** A moment of the directed film, in this film's seconds. */
  const at = (s: number): number => (s * length) / DIRECTED_LENGTH_S;

  // A page can hold two scenes (the film and the technical section's scrubber): ids must not collide.
  scenesBuilt++;
  const id = (name: string): string => `${name}-${String(scenesBuilt)}`;
  const ref = (name: string): string => `url(#${id(name)})`;

  const scene = html("div", "scene");
  scene.style.width = px(w);
  scene.style.height = px(h);
  scene.style.background = ink;
  host.append(scene);

  const art = svg("svg", { width: w, height: h, viewBox: `0 0 ${num(w)} ${num(h)}`, class: "art" });
  scene.append(art);
  const defs = svg("defs", {});
  art.append(defs);

  // The light: a low sun through the window, warm at the source and falling off across the room.
  const sun = gradient("radialGradient", id("sun"), { gradientUnits: "userSpaceOnUse", r: Math.max(w, h) * 1.05 }, [
    [0, sunCore, 0.95],
    [0.38, sunFall, 0.42],
    [1, sunFall, 0],
  ]);
  // The scrim keeps the words legible: dark where the text sits, open where the cup is. In landscape
  // the text column has a fixed place; in portrait its stops follow the laid-out text (below).
  const scrim = landscape
    ? gradient("linearGradient", id("scrim"), { x1: 1, y1: 0, x2: 0, y2: 0 }, [[0, ink, 0.94], [0.34, ink, 0.9], [0.46, ink, 0.74], [0.56, ink, 0.4], [0.68, ink, 0.1], [0.78, ink, 0]])
    : gradient("linearGradient", id("scrim"), { x1: 0, y1: 0, x2: 0, y2: 1 }, []);
  const vignette = gradient("radialGradient", id("vignette"), { cx: 0.5, cy: 0.55, r: 0.75 }, [[0.55, ink, 0], [1, ink, 0.5]]);
  defs.append(sun, scrim, vignette);

  const image = svg("image", { href: data.imageUrl, preserveAspectRatio: "none" });
  const panel = landscape && composition.framing === "whole" ? Math.min(w, Math.max(w * PANEL_MIN, h * imageAspect)) : w;
  const stage: Box = { x: 0, y: 0, w: panel, h };
  if (panel < w) {
    const fade = gradient("linearGradient", id("fade"), { gradientUnits: "userSpaceOnUse", x1: panel * PANEL_FADE, y1: 0, x2: panel, y2: 0 }, [[0, "#ffffff", 1], [1, "#ffffff", 0]]);
    const mask = svg("mask", { id: id("panel"), maskUnits: "userSpaceOnUse", x: 0, y: 0, width: w, height: h });
    mask.append(svg("rect", { x: 0, y: 0, width: panel, height: h, fill: ref("fade") }));
    defs.append(fade, mask);
    image.setAttribute("mask", ref("panel"));
  }
  const dark = svg("rect", { x: 0, y: 0, width: w, height: h, fill: ink });
  const light = svg("rect", { x: 0, y: 0, width: w, height: h, fill: ref("sun"), style: "mix-blend-mode: soft-light" });
  const glow = svg("rect", { x: 0, y: 0, width: w, height: h, fill: ref("sun"), style: "mix-blend-mode: screen" });
  const shade = svg("rect", { x: 0, y: 0, width: w, height: h, fill: ref("vignette") });
  const scrimRect = svg("rect", { x: 0, y: 0, width: w, height: h, fill: ref("scrim") });
  art.append(image, dark, light, glow, shade, scrimRect);
  describeArt(art, data.alt);

  // Film grain. Rendered films get fresh grain every frame; a live page gets one fixed tile, since a
  // full-frame noise filter recomputed per frame is the most expensive thing a phone could draw here.
  let turbulence: SVGFETurbulenceElement | undefined;
  if (data.medium === "web") {
    scene.append(grainLayer(GRAIN_OPACITY));
  } else {
    turbulence = svg("feTurbulence", { type: "fractalNoise", baseFrequency: 0.85, numOctaves: 2, seed: 1 });
    const grain = svg("filter", { id: id("grain"), x: 0, y: 0, width: 1, height: 1 });
    grain.append(turbulence, svg("feColorMatrix", { type: "saturate", values: 0 }));
    defs.append(grain);
    art.append(svg("rect", { x: 0, y: 0, width: w, height: h, filter: ref("grain"), opacity: GRAIN_OPACITY, style: "mix-blend-mode: overlay" }));
  }

  const text = html("article", "text");
  text.dataset["lager"] = "text";
  scene.append(text);

  // Title block: where the scrim is darkest.
  const column: Box = landscape
    ? { x: w * 0.555, y: safe.y, w: safe.x + safe.w - w * 0.555, h: safe.h }
    : safe;
  const head = html("div", "head");
  head.style.left = px(column.x);
  head.style.top = px(column.y + (landscape ? 1.5 * u : 0));
  head.style.width = px(column.w);
  text.append(head);

  const kickerRow = html("div", "kicker-row");
  kickerRow.style.gap = px(1.6 * u);
  kickerRow.style.marginBottom = px(2.6 * u);
  const kickerMark = html("span", "kicker-mark");
  kickerMark.style.width = px(4.2 * u);
  kickerMark.style.height = px(0.4 * u);
  kickerMark.style.background = accent;
  const kicker = html("p", "kicker", copy.label);
  typeStyle(kicker, tokens.type.label, labelPx);
  kicker.style.color = quiet;
  kicker.dataset["role"] = "label";
  kickerRow.append(kickerMark, kicker);
  if (copy.label !== "") head.append(kickerRow);

  const headline = html("h1", "headline");
  headline.dataset["role"] = "display";
  typeStyle(headline, tokens.type.display, displayPx);
  headline.style.color = paper;
  const setLines = (texts: readonly string[]): HTMLElement[] => {
    headline.replaceChildren();
    return texts.map((line, i) => {
      const mask = html("span", "mask");
      const inner = html("span", "line", line);
      mask.append(inner);
      // A space between the lines, so the heading reads as one sentence; between blocks it has no box.
      if (i > 0) headline.append(" ");
      headline.append(mask);
      return inner;
    });
  };
  let lines = setLines(copy.headline);
  head.append(headline);
  let inked = widestLine(headline);
  // A line wider than the column first makes the headline smaller, never below the type scale's floor;
  // a line still too wide then breaks between words. Only a single over-long word overflows.
  if (inked > column.w) {
    displayPx = Math.max(scaleFloorPx, (displayPx * column.w * FIT) / inked);
    typeStyle(headline, tokens.type.display, displayPx);
    bodyPx = bodyOf(displayPx);
    if (widestLine(headline) > column.w) lines = setLines(wrapLines(copy.headline, column.w, headline));
    inked = widestLine(headline);
  }
  // A narrow screen: the body is at its legibility floor, so the type scale would come up short. The
  // headline grows until its widest line fills the column, and never past the full scale.
  if (bodyPx <= tokens.rules.min_body_px && inked > 0) {
    const grow = Math.min((NARROW_HEADLINE_FILL * column.w) / inked, (bodyPx * (tokens.rules.display_to_body_min_ratio + 0.1)) / displayPx);
    if (grow > 1) typeStyle(headline, tokens.type.display, displayPx * grow);
  }

  const deck = html("p", "deck", copy.body);
  typeStyle(deck, tokens.type.body, bodyPx);
  deck.style.color = paper;
  deck.style.marginTop = px(3 * u);
  deck.style.maxWidth = px(Math.min(column.w, bodyPx * (landscape ? 22 : 21)));
  deck.dataset["role"] = "body";
  if (copy.body !== "") head.append(deck);

  // The steeping time: the instruction stands still, the line fills as four real minutes pass in the
  // film. A changing number read as a countdown that jumped back to four at the end.
  // A campaign without a timed instruction has no row; the beats around it stay where they were.
  const steepRow = html("div", "steep-row");
  steepRow.style.marginTop = px(3.4 * u);
  steepRow.style.gap = px(1.6 * u);
  steepRow.style.width = px(Math.min(column.w, bodyPx * 16));
  const steepTrack = html("span", "steep-track");
  steepTrack.style.height = px(Math.max(2, 0.22 * u));
  steepTrack.style.background = `color-mix(in srgb, ${paper} 22%, transparent)`;
  const steepFill = html("span", "steep-fill");
  steepFill.style.background = accent;
  steepTrack.append(steepFill);
  const steep = html("p", "steep", copy.steep === undefined ? "" : `${num(copy.steep.minutes)} min · ${num(copy.steep.temperature_c)} °C`);
  typeStyle(steep, tokens.type.label, labelPx);
  steep.style.color = quiet;
  steep.dataset["role"] = "label";
  steepRow.append(steepTrack, steep);
  if (copy.steep !== undefined) head.append(steepRow);

  // Credits: the brand and the release date, as at the foot of a poster.
  const foot = html("div", "foot");
  foot.style.left = px(column.x);
  foot.style.bottom = px(m + inset.bottom);
  foot.style.width = px(column.w);
  const wordmark = html("p", "wordmark", data.brand);
  // A narrow screen may wrap the line, but only between its phrases: "1 December" never splits.
  const cta = html("p", "cta");
  copy.cta.split(" · ").forEach((phrase, i) => {
    if (i > 0) cta.append(" · ");
    cta.append(html("span", "phrase", phrase));
  });
  for (const el of [wordmark, cta]) {
    typeStyle(el, tokens.type.label, labelPx);
    el.style.color = paper;
    el.dataset["role"] = "label";
    if (el.textContent !== "") foot.append(el);
  }
  wordmark.style.letterSpacing = "0.3em";
  const hasFoot = foot.childElementCount > 0;
  if (hasFoot) text.append(foot);
  // A phrase longer than the column itself may break between its words after all; overflowing is worse.
  for (const phrase of cta.querySelectorAll<HTMLElement>(".phrase")) {
    if (phrase.getBoundingClientRect().width > column.w) phrase.style.whiteSpace = "normal";
  }

  // Measured before any motion: where this canvas's title block ends and its credits begin. A short
  // screen whose text runs further down still gets the dark behind every line.
  if (!landscape) {
    const top = scene.getBoundingClientRect().top;
    // The dark holds a little past the last line (the steeping row), before it starts to open.
    const hold = 2 * u;
    addStops(scrim, verticalScrim(tall, (head.getBoundingClientRect().bottom - top + hold) / h, ((hasFoot ? foot.getBoundingClientRect().top : top + h - m) - top) / h, ink));
  }
  const shadowStops = [...scrim.querySelectorAll("stop"), ...vignette.querySelectorAll("stop")];

  function seek(t: number): void {
    const camera = place(image, stage, w, h, data, imageAspect, shot, shot.zoom * (1 + shot.push * inOut(phase(t, 0, length))));
    const sx = camera.x + lightAt.x * camera.w;
    const sy = camera.y + lightAt.y * camera.h;
    for (const attr of [["cx", sx], ["cy", sy], ["fx", sx], ["fy", sy]] as const) sun.setAttribute(attr[0], num(attr[1]));

    // Dawn: the blue dark lifts, the sun comes up through the window. The cup is already there in
    // the blue at the first frame: the subject before the light, so a viewer who stops for one
    // second sees what this is.
    const dawn = inOut(phase(t, at(0.2), at(5.4)));
    dark.setAttribute("opacity", num(night * (1 - dawn)));
    const sunrise = inOut(phase(t, at(1.0), at(5.4)));
    light.setAttribute("opacity", num(sunrise));
    glow.setAttribute("opacity", num(0.24 * sunrise));
    const shadow = mixHex(ink, warmth, WARM_SHADOW * sunrise);
    for (const stop of shadowStops) stop.setAttribute("stop-color", shadow);
    turbulence?.setAttribute("seed", num(Math.floor(t * 12)));

    // The message lands inside the first second; the rest of the reading path follows the light.
    fadeIn(kickerRow, t, at(0.1), 0.8 * u);
    kickerMark.style.transform = `scaleX(${num(expoOut(phase(t, at(0.15), at(1.0))))})`;
    lines.forEach((el, i) => {
      const e = expoOut(phase(t, at(0.2 + 0.2 * i), at(1.3)));
      el.style.transform = `translateY(${num((1 - e) * 110)}%)`;
      // Hidden until it starts to rise, so no sliver of a waiting line shows under the one above.
      el.style.opacity = String(clamp01(e * 4));
    });
    fadeIn(deck, t, at(2.4), 1.2 * u);
    fadeIn(steepRow, t, at(3.4), 0.6 * u);
    const steeped = inOut(phase(t, at(3.8), at(3.0)));
    steepFill.style.transform = `scaleX(${num(steeped)})`;
    fadeIn(foot, t, at(7.2), 0.8 * u);
  }

  function measure(): Measurement {
    const nodes: readonly (readonly [HTMLElement, string])[] = [
      [kicker, "kicker"],
      [headline, "headline"],
      [deck, "deck"],
      [steep, "steep"],
      [wordmark, "wordmark"],
      [cta, "cta"],
    ];
    return {
      texts: nodes.filter(([el]) => el.isConnected).map(([el, name]) => measureText(el, name, column.x + column.w)),
      images: [{ kind: "rect", box: { x: 0, y: 0, w, h }, stage: true }],
      ground: getComputedStyle(scene).backgroundColor,
      safe,
      fontsLoaded: loadedFonts(),
    };
  }

  return { seek, measure };
};
