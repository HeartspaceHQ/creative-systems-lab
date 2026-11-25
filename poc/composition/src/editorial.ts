/**
 * Editorial page: a full-bleed photograph and a typeset column, as in a printed journal.
 *
 * Portrait formats stack masthead, photo and column; landscape puts the photo on the left half and
 * the column on the right. The photo is cropped to its region around the designer's focus point and
 * never carries text. The steeping time and the running head are optional, and so is any text that
 * is empty: the column closes up around what there is. Every visual state is a pure function of t;
 * see kit.ts for the contract.
 */
import { clamp01, colourOf, coverImage, expoOut, fadeIn, BODY_MAX_U, FIT, html, inOut, loadedFonts, measureText, num, phase, px, svg, typeStyle, widestLine, wrapLines, type Build } from "./kit.ts";
import { shapeOf } from "./shape.ts";
import type { Box, Measurement } from "./types.ts";

/** Share of a landscape canvas given to the photograph. */
const LANDSCAPE_PHOTO = 0.54;

export const build: Build = (data, imageAspect, host) => {
  const { width: w, height: h } = data.format;
  const { tokens, copy } = data;
  const steepCopy = copy.steep;
  const composition = data.composition ?? {};
  const shape = shapeOf(w, h);
  const landscape = shape === "wide";
  const tall = shape === "tall";
  const u = Math.min(w, h) / 100;
  const m = tokens.rules.safe_margin_u * u;
  // A small canvas or a small headline would leave the body at its floor and the type scale below its own.
  const scaleFloorPx = tokens.rules.min_body_px * (tokens.rules.display_to_body_min_ratio + 0.1);
  let displayPx = Math.max(scaleFloorPx, (landscape ? 11 : tall ? 11.5 : 9.4) * u * (composition.headline ?? 1));
  // Body follows the headline down to the scale's ratio, but never past a size that reads as body copy on this canvas.
  const bodyOf = (display: number): number =>
    Math.max(tokens.rules.min_body_px, Math.min(display / (tokens.rules.display_to_body_min_ratio + 0.1), BODY_MAX_U * u));
  let bodyPx = bodyOf(displayPx);
  const labelPx = Math.max(13, 1.75 * u);
  const ink = colourOf(data, "text");
  const quiet = colourOf(data, "quiet");
  const accent = colourOf(data, "accent");
  const hairline = 0.14 * u;

  const scene = html("div", "scene");
  scene.style.width = px(w);
  scene.style.height = px(h);
  scene.style.background = colourOf(data, "ground");
  host.append(scene);

  const art = svg("svg", { width: w, height: h, viewBox: `0 0 ${num(w)} ${num(h)}`, class: "art" });
  scene.append(art);
  const text = html("div", "text");
  text.dataset["lager"] = "text";
  scene.append(text);

  // The text column: where it sits decides where the photograph may go.
  const column: Box = landscape
    ? { x: w * LANDSCAPE_PHOTO + 5.5 * u, y: m, w: w - m - (w * LANDSCAPE_PHOTO + 5.5 * u), h: h - 2 * m }
    : { x: m, y: m, w: w - 2 * m, h: h - 2 * m };

  const masthead = html("div", "masthead");
  masthead.style.left = px(column.x);
  masthead.style.top = px(column.y);
  masthead.style.width = px(column.w);
  const wordmark = html("div", "wordmark", data.brand.toUpperCase());
  const folio = copy.folio === undefined ? undefined : html("div", "folio", copy.folio);
  for (const el of folio === undefined ? [wordmark] : [wordmark, folio]) {
    typeStyle(el, tokens.type.label, labelPx);
    el.style.color = ink;
    el.dataset["role"] = "label";
    masthead.append(el);
  }
  wordmark.style.letterSpacing = "0.3em";
  if (folio !== undefined) folio.style.color = quiet;
  text.append(masthead);
  const mastheadBottom = column.y + masthead.getBoundingClientRect().height;
  const topRuleY = mastheadBottom + 1.6 * u;

  const block = html("div", "block");
  block.style.left = px(column.x);
  block.style.bottom = px(m);
  block.style.width = px(column.w);
  text.append(block);

  const kickerRow = html("div", "kicker-row");
  kickerRow.style.gap = px(1.6 * u);
  kickerRow.style.marginBottom = px(2.2 * u);
  const kickerMark = html("span", "kicker-mark");
  kickerMark.style.width = px(4.2 * u);
  kickerMark.style.height = px(0.5 * u);
  kickerMark.style.background = accent;
  const kicker = html("div", "kicker", copy.label.toUpperCase());
  typeStyle(kicker, tokens.type.label, labelPx);
  kicker.style.color = quiet;
  kicker.dataset["role"] = "label";
  kickerRow.append(kickerMark, kicker);
  if (copy.label !== "") block.append(kickerRow);

  const headline = html("div", "headline");
  headline.dataset["role"] = "display";
  typeStyle(headline, tokens.type.display, displayPx);
  headline.style.color = ink;
  const setLines = (texts: readonly string[]): HTMLElement[] => {
    headline.replaceChildren();
    return texts.map((line) => {
      const mask = html("span", "mask");
      const inner = html("span", "line", line);
      mask.append(inner);
      headline.append(mask);
      return inner;
    });
  };
  let lines = setLines(copy.headline);
  block.append(headline);
  // A line wider than the column first makes the whole headline smaller, never below the type scale's
  // floor; a line still too wide then breaks between words. Only a single over-long word overflows.
  const widest = widestLine(headline);
  if (widest > column.w) {
    displayPx = Math.max(scaleFloorPx, (displayPx * column.w * FIT) / widest);
    typeStyle(headline, tokens.type.display, displayPx);
    bodyPx = bodyOf(displayPx);
    if (widestLine(headline) > column.w) lines = setLines(wrapLines(copy.headline, column.w, headline));
  }

  const deck = html("div", "deck", copy.body);
  typeStyle(deck, tokens.type.body, bodyPx);
  deck.style.color = ink;
  deck.style.marginTop = px(2.8 * u);
  deck.style.maxWidth = px(Math.min(column.w, bodyPx * 24));
  deck.dataset["role"] = "body";
  if (copy.body !== "") block.append(deck);

  const foot = html("div", "foot");
  foot.style.marginTop = px(4.2 * u);
  foot.style.paddingTop = px(1.8 * u);
  const steep = steepCopy === undefined ? undefined : html("div", "steep", `${num(steepCopy.minutes)} min · ${num(steepCopy.temperature_c)} °C`);
  const cta = html("div", "cta", copy.cta);
  const footLines: (readonly [HTMLElement, string])[] = [[cta, ink]];
  if (steep !== undefined) footLines.unshift([steep, quiet]);
  for (const [el, colour] of footLines) {
    typeStyle(el, tokens.type.label, labelPx);
    el.style.color = colour;
    el.dataset["role"] = "label";
    if (el !== cta || copy.cta !== "") foot.append(el);
  }
  const hasFoot = foot.childElementCount > 0;
  if (hasFoot) block.append(foot);

  const blockTop = h - m - block.getBoundingClientRect().height;
  const footRuleY = hasFoot ? h - m - foot.getBoundingClientRect().height : undefined;

  // The photograph takes what the text leaves: full bleed to the canvas edges it touches.
  const photoRegion: Box = landscape
    ? { x: 0, y: 0, w: w * LANDSCAPE_PHOTO, h }
    : { x: 0, y: topRuleY + 2.6 * u, w, h: Math.max(0, blockTop - 5 * u - (topRuleY + 2.6 * u)) };

  const defs = svg("defs", {});
  const clip = svg("clipPath", { id: "photo" });
  const clipRect = svg("rect", { x: photoRegion.x, y: photoRegion.y, width: photoRegion.w, height: photoRegion.h });
  clip.append(clipRect);
  defs.append(clip);
  art.append(defs);
  const photo = svg("g", { "clip-path": "url(#photo)" });
  const image = svg("image", { href: data.imageUrl, preserveAspectRatio: "none" });
  photo.append(image);
  art.append(photo);

  const rule = (y: number): SVGLineElement => {
    const el = svg("line", { x1: column.x, y1: y, x2: column.x, y2: y, stroke: ink, "stroke-width": hairline });
    art.append(el);
    return el;
  };
  const topRule = rule(topRuleY);
  const footRule = footRuleY === undefined ? undefined : rule(footRuleY);
  // Brand motif carried over from the first campaign: the steeping time as a filling line.
  const steepLine = footRuleY === undefined || steepCopy === undefined
    ? undefined
    : svg("line", { x1: column.x, y1: footRuleY, x2: column.x, y2: footRuleY, stroke: accent, "stroke-width": 0.42 * u });
  if (steepLine !== undefined) art.append(steepLine);
  const steepShare = (steepCopy?.minutes ?? 0) / 5;

  const reveal = (t: number): void => {
    const e = expoOut(phase(t, 0.1, 1.5));
    if (landscape) clipRect.setAttribute("width", num(photoRegion.w * e));
    else clipRect.setAttribute("height", num(photoRegion.h * e));
  };

  function seek(t: number): void {
    const motion = tokens.motion;
    reveal(t);
    // Never closer than covering the region: a zoom below 1 would leave the photograph short of its edges.
    coverImage(image, photoRegion, data.focus, imageAspect, Math.max(1, (1.07 - 0.07 * inOut(phase(t, 0, motion.length_s))) * (composition.zoom ?? 1)));
    topRule.setAttribute("x2", num(column.x + column.w * expoOut(phase(t, 0.3, 1.2))));
    footRule?.setAttribute("x2", num(column.x + column.w * expoOut(phase(t, 2.0, 1.2))));
    steepLine?.setAttribute("x2", num(column.x + column.w * steepShare * inOut(phase(t, 2.4, motion.steep_arc_s - 1.2))));
    fadeIn(masthead, t, 0.2, 0.8 * u);
    fadeIn(kickerRow, t, 0.8, 0.8 * u);
    kickerMark.style.transform = `scaleX(${num(expoOut(phase(t, 0.9, 0.9)))})`;
    lines.forEach((el, i) => {
      const e = expoOut(phase(t, 1.0 + 0.18 * i, 1.1));
      el.style.transform = `translateY(${num((1 - e) * 108)}%)`;
      el.style.opacity = String(clamp01(e * 4));
    });
    fadeIn(deck, t, 1.8, 1.2 * u);
    fadeIn(foot, t, 2.3, 0.8 * u);
  }

  function measure(): Measurement {
    const nodes: readonly (readonly [HTMLElement | undefined, string])[] = [
      [wordmark, "wordmark"],
      [folio, "folio"],
      [kicker, "kicker"],
      [headline, "headline"],
      [deck, "deck"],
      [steep, "steep"],
      [cta, "cta"],
    ];
    const shown = nodes.flatMap(([el, name]) => (el?.isConnected === true ? [[el, name] as const] : []));
    return {
      texts: shown.map(([el, name]) => measureText(el, name, column.x + column.w)),
      images: [{ kind: "rect", box: photoRegion }],
      ground: getComputedStyle(scene).backgroundColor,
      safe: { x: m, y: m, w: w - 2 * m, h: h - 2 * m },
      fontsLoaded: loadedFonts(),
    };
  }

  return { seek, measure };
};
