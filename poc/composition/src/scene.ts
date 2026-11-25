/**
 * The first campaign scene: the photo in a disc with a steeping dial. Every visual state is a pure
 * function of time t and the injected data: no CSS animations and no clocks, so a frame is
 * reproducible from (data, t) alone. Shared helpers and the render contract live in kit.ts.
 */
import { clamp01, colourOf, expoOut, fadeIn, html, inOut, loadedFonts, measureText, num, phase, px, svg, typeStyle, type Build } from "./kit.ts";
import { shapeOf } from "./shape.ts";
import type { Box, Measurement, TextMeasure } from "./types.ts";

const DIAL_MINUTES = 5;
const TICKS_PER_MINUTE = 4;

export const build: Build = (data, _imageAspect, host) => {
  const { width: w, height: h } = data.format;
  const { tokens, copy } = data;
  // This scene is built around the steeping time; a campaign without one belongs in another scene.
  const steepCopy = copy.steep;
  if (steepCopy === undefined) throw new Error("this scene needs copy.steep");
  const shape = shapeOf(w, h);
  const landscape = shape === "wide";
  const tall = shape === "tall";
  const u = Math.min(w, h) / 100;
  const m = tokens.rules.safe_margin_u * u;
  const displayPx = (landscape ? 12.5 : tall ? 15 : 12) * u;
  const bodyPx = Math.max(14, displayPx / (tokens.rules.display_to_body_min_ratio + 0.15));
  const labelPx = Math.max(13, 1.9 * u);

  const scene = html("div", "scene");
  scene.style.width = px(w);
  scene.style.height = px(h);
  scene.style.background = colourOf(data, "ground");
  host.append(scene);

  const art = svg("svg", { width: w, height: h, viewBox: `0 0 ${num(w)} ${num(h)}`, class: "art" });
  scene.append(art);

  // Text layer first: the composition is laid out around the measured text, not the other way round.
  const text = html("div", "text");
  text.dataset["lager"] = "text";
  scene.append(text);

  const wordmark = html("div", "wordmark", data.brand.toUpperCase());
  typeStyle(wordmark, tokens.type.label, labelPx * 1.15);
  wordmark.style.letterSpacing = "0.32em";
  wordmark.style.color = colourOf(data, "text");
  wordmark.dataset["role"] = "label";
  wordmark.style.left = px(m);
  wordmark.style.top = px(m);
  text.append(wordmark);

  const block = html("div", "block");
  block.style.left = px(m);
  block.style.bottom = px(m);
  block.style.width = landscape ? px(w * 0.44 - m) : px(w - 2 * m);
  block.style.gap = px(2.6 * u);
  text.append(block);

  const label = html("div", "label", copy.label.toUpperCase());
  typeStyle(label, tokens.type.label, labelPx);
  label.style.color = colourOf(data, "quiet");
  label.dataset["role"] = "label";
  block.append(label);

  const headline = html("div", "headline");
  headline.dataset["role"] = "display";
  typeStyle(headline, tokens.type.display, displayPx);
  headline.style.color = colourOf(data, "text");
  const lines = copy.headline.map((line) => {
    const mask = html("span", "mask");
    const inner = html("span", "line", line);
    mask.append(inner);
    headline.append(mask);
    return inner;
  });
  block.append(headline);

  const body = html("div", "body", copy.body);
  typeStyle(body, tokens.type.body, bodyPx);
  body.style.color = colourOf(data, "text");
  body.dataset["role"] = "body";
  block.append(body);

  const row = html("div", "row");
  row.style.marginTop = px(1.4 * u);
  row.style.gap = px(3 * u);
  const steep = html("div", "steep", `Steep ${num(steepCopy.minutes)} min at ${num(steepCopy.temperature_c)} °C`);
  const cta = html("div", "cta", copy.cta);
  for (const [el, colour] of [[steep, colourOf(data, "quiet")], [cta, colourOf(data, "text")]] as const) {
    typeStyle(el, tokens.type.label, labelPx);
    el.style.color = colour;
    el.dataset["role"] = "label";
    row.append(el);
  }
  block.append(row);

  // Composition rule: the image disc takes the largest circle that fits the space the text leaves,
  // aligned to the right margin. Text never sits on the generated image.
  const blockTop = h - m - block.getBoundingClientRect().height;
  const gap = 4 * u;
  const region: Box = landscape
    ? { x: m + w * 0.44 + gap, y: m, w: w - 2 * m - w * 0.44 - gap, h: h - 2 * m }
    : { x: m, y: m + wordmark.getBoundingClientRect().height + gap, w: w - 2 * m, h: blockTop - gap - (m + wordmark.getBoundingClientRect().height + gap) };
  const R = Math.min(region.w, region.h) / 2;
  const cx = region.x + region.w - R;
  const cy = region.y + region.h / 2;
  const r = R * 0.82;

  const clipId = "disc";
  const clip = svg("clipPath", { id: clipId });
  const clipCircle = svg("circle", { cx, cy, r });
  clip.append(clipCircle);
  const defs = svg("defs", {});
  defs.append(clip);
  art.append(defs);

  const accent = colourOf(data, "accent");
  const line = colourOf(data, "line");

  const ripples = [0, 1, 2].map(() => {
    const ring = svg("circle", { cx, cy, r, fill: "none", stroke: accent, "stroke-width": 0.35 * u });
    art.append(ring);
    return ring;
  });

  const photo = svg("g", { "clip-path": `url(#${clipId})` });
  const image = svg("image", { href: data.imageUrl, preserveAspectRatio: "xMidYMid slice" });
  photo.append(image);
  art.append(photo);

  const dialR = R * 0.93;
  const tickCount = DIAL_MINUTES * TICKS_PER_MINUTE;
  const ticks = Array.from({ length: tickCount }, (_, k) => {
    const major = k % TICKS_PER_MINUTE === 0;
    const angle = (k / tickCount) * 2 * Math.PI - Math.PI / 2;
    const inner = dialR - (major ? 2.4 : 1.2) * u;
    const tick = svg("line", {
      x1: cx + Math.cos(angle) * inner,
      y1: cy + Math.sin(angle) * inner,
      x2: cx + Math.cos(angle) * dialR,
      y2: cy + Math.sin(angle) * dialR,
      stroke: line,
      "stroke-width": (major ? 0.32 : 0.18) * u,
      "stroke-linecap": "round",
    });
    art.append(tick);
    return tick;
  });

  const arcR = R * 0.985;
  const arc = svg("path", { fill: "none", stroke: accent, "stroke-width": 0.7 * u, "stroke-linecap": "round" });
  const tip = svg("circle", { r: 1.1 * u, fill: accent });
  art.append(arc, tip);

  const sweep = steepCopy.minutes / DIAL_MINUTES;

  function placeImage(zoom: number): void {
    const size = 2 * r * zoom;
    const fx = data.focus.x * size;
    const fy = data.focus.y * size;
    const x = Math.min(cx - r, Math.max(cx + r - size, cx - fx));
    const y = Math.min(cy - r, Math.max(cy + r - size, cy - fy));
    image.setAttribute("x", String(x));
    image.setAttribute("y", String(y));
    image.setAttribute("width", String(size));
    image.setAttribute("height", String(size));
  }

  function arcPath(fraction: number): string {
    if (fraction <= 0) return "";
    const a0 = -Math.PI / 2;
    const a1 = a0 + fraction * 2 * Math.PI;
    const large = fraction > 0.5 ? 1 : 0;
    const point = (a: number): string => `${num(cx + Math.cos(a) * arcR)} ${num(cy + Math.sin(a) * arcR)}`;
    return `M ${point(a0)} A ${num(arcR)} ${num(arcR)} 0 ${num(large)} 1 ${point(a1)}`;
  }

  const fades: readonly (readonly [HTMLElement, number])[] = [
    [wordmark, 0.2],
    [label, 0.7],
    [body, 1.9],
    [row, 2.3],
  ];

  function seek(t: number): void {
    const motion = tokens.motion;
    clipCircle.setAttribute("r", String(r * expoOut(phase(t, 0, 1.4))));
    placeImage(1.14 - 0.14 * inOut(phase(t, 0, motion.length_s)));

    ripples.forEach((ring, i) => {
      const p = phase(t, 0.5 + 0.45 * i, motion.ring_ripple_s);
      const e = expoOut(p);
      ring.setAttribute("r", String(r + (R * 1.45 - r) * e));
      ring.setAttribute("opacity", String(p <= 0 || p >= 1 ? 0 : 0.6 * (1 - e)));
    });

    ticks.forEach((tick, k) => { tick.setAttribute("opacity", String(0.55 * phase(t, 0.9 + k * 0.035, 0.25))); });

    const sweepNow = sweep * inOut(phase(t, 1.3, motion.steep_arc_s));
    arc.setAttribute("d", arcPath(sweepNow));
    const tipAngle = -Math.PI / 2 + sweepNow * 2 * Math.PI;
    tip.setAttribute("cx", String(cx + Math.cos(tipAngle) * arcR));
    tip.setAttribute("cy", String(cy + Math.sin(tipAngle) * arcR));
    tip.setAttribute("opacity", sweepNow > 0 ? "1" : "0");

    lines.forEach((el, i) => {
      const e = expoOut(phase(t, 0.9 + 0.2 * i, 1.1));
      el.style.transform = `translateY(${num((1 - e) * 108)}%)`;
      // Hidden until it starts to rise, so no sliver of a waiting line shows under the one above.
      el.style.opacity = String(clamp01(e * 4));
    });
    for (const [el, begin] of fades) fadeIn(el, t, begin, 1.2 * u);
  }

  function measure(): Measurement {
    const nodes: readonly (readonly [HTMLElement, string])[] = [
      [wordmark, "wordmark"],
      [label, "label"],
      [headline, "headline"],
      [body, "body"],
      [steep, "steep"],
      [cta, "cta"],
    ];
    const texts: TextMeasure[] = nodes.map(([el, name]) => measureText(el, name, w - m));
    return {
      texts,
      images: [{ kind: "disc", cx, cy, r }],
      ground: getComputedStyle(scene).backgroundColor,
      safe: { x: m, y: m, w: w - 2 * m, h: h - 2 * m },
      fontsLoaded: loadedFonts(),
    };
  }

  return { seek, measure };
};
