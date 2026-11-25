/**
 * The live preview of CSL Studio, run inside an iframe of the studio on the same origin.
 *
 * The parent posts a scene message (brand, design, image, size, time); this page builds the real
 * layout through the engine's own `build`, fits the canvas to the iframe and answers `ready` with the
 * text blocks that do not fit, or `error`. Fonts and images are kept between messages, so editing is
 * a rebuild, not a reload. The design is built at full size, where the layout is measured, and the
 * finished canvas is then scaled to the iframe.
 */
import { inside } from "./checks.ts";
import { build as buildCinema } from "./cinema.ts";
import { build as buildEditorial } from "./editorial.ts";
import { loadImage, loadTypeFaces, type Built } from "./kit.ts";
import { parseDesign, StudioError, studioSceneData, type StudioLayout } from "./studio-design.ts";

/** Which moment of the film to show: its end state, the film looping, or one second of it. */
type Time = "end" | "play" | number;

interface SceneMessage {
  readonly type: "scene";
  readonly id: unknown;
  readonly brand: unknown;
  readonly design: unknown;
  /** The fonts on offer, bundled and uploaded; the brand names two of them. */
  readonly fonts: unknown;
  readonly imageUrl: string;
  readonly format: string;
  readonly time: Time;
}

const LAYOUTS = { editorial: buildEditorial, cinema: buildCinema } as const;
/** A looping film rests this long on its end state before it starts over. */
const LOOP_REST_S = 1.5;
/** Images kept between messages: the one in use and a few the designer is trying. */
const IMAGE_CACHE = 8;
/** The longest to wait for a frame to be painted before saying ready; a hidden frame never paints. */
const PAINT_WAIT_MS = 120;

const stage = document.getElementById("stage");
if (stage === null) throw new Error("studio.html has no #stage");
const sheets: Readonly<Record<StudioLayout, HTMLLinkElement>> = {
  editorial: linkOf("css-editorial"),
  cinema: linkOf("css-cinema"),
};

function linkOf(id: string): HTMLLinkElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLLinkElement)) throw new Error(`studio.html has no stylesheet #${id}`);
  return el;
}

/** Both stylesheets, loaded (or failed, which the first build then reports as missing fonts). */
const stylesheetsLoaded = Promise.all(
  Object.values(sheets).map((link) =>
    link.sheet === null
      ? new Promise<void>((done) => {
        link.addEventListener("load", () => { done(); }, { once: true });
        link.addEventListener("error", () => { done(); }, { once: true });
      })
      : Promise.resolve(),
  ),
);

const reply = (message: Record<string, unknown>): void => {
  window.parent.postMessage(message, location.origin);
};

const images = new Map<string, Promise<HTMLImageElement>>();

/** The image, loaded once per URL. A failed load is forgotten, so a retry loads it again. */
function cachedImage(url: string): Promise<HTMLImageElement> {
  const known = images.get(url);
  if (known !== undefined) return known;
  const loading = loadImage(url);
  images.set(url, loading);
  loading.catch(() => images.delete(url));
  const oldest = images.keys().next();
  if (images.size > IMAGE_CACHE && oldest.done !== true) images.delete(oldest.value);
  return loading;
}

/** The preview only shows images the studio itself serves. */
function sameOriginImage(url: string): string {
  const resolved = new URL(url, location.href);
  if (resolved.origin !== location.origin && resolved.protocol !== "blob:" && resolved.protocol !== "data:") {
    throw new StudioError({ imageUrl: "The preview can only show images from the studio itself." });
  }
  return resolved.href;
}

function readMessage(data: unknown): SceneMessage | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const raw = data as Record<string, unknown>;
  if (raw["type"] !== "scene") return undefined;
  const time = raw["time"] ?? "end";
  const imageUrl = raw["imageUrl"];
  const format = raw["format"];
  const validTime = time === "end" || time === "play" || (typeof time === "number" && Number.isFinite(time) && time >= 0);
  if (typeof imageUrl !== "string" || typeof format !== "string" || !validTime) {
    reply({ type: "error", id: raw["id"], message: "The preview was asked for a scene it cannot show." });
    return undefined;
  }
  return { type: "scene", id: raw["id"], brand: raw["brand"], design: raw["design"], fonts: raw["fonts"], imageUrl, format, time };
}

/** Fit the canvas into the iframe, as large as it goes without cropping, centred. */
let canvas = { width: 0, height: 0 };
function fit(): void {
  if (stage === null || canvas.width === 0) return;
  const scale = Math.min(window.innerWidth / canvas.width, window.innerHeight / canvas.height);
  const x = (window.innerWidth - canvas.width * scale) / 2;
  const y = (window.innerHeight - canvas.height * scale) / 2;
  stage.style.transform = `translate(${String(x)}px, ${String(y)}px) scale(${String(scale)})`;
}
window.addEventListener("resize", fit);

let loop: number | undefined;
let loopBegan = 0;

function stopLoop(): void {
  if (loop !== undefined) cancelAnimationFrame(loop);
  loop = undefined;
}

function playLoop(scene: Built, lengthS: number): void {
  const frame = (now: number): void => {
    scene.seek(((now - loopBegan) / 1000) % (lengthS + LOOP_REST_S));
    loop = requestAnimationFrame(frame);
  };
  loop = requestAnimationFrame(frame);
}

const painted = (): Promise<void> =>
  new Promise((done) => {
    const timer = setTimeout(done, PAINT_WAIT_MS);
    requestAnimationFrame(() => { requestAnimationFrame(() => { clearTimeout(timer); done(); }); });
  });

/** The layout whose stylesheet is on; the other is disabled. */
let shown: StudioLayout | undefined;

async function show(message: SceneMessage): Promise<string[]> {
  if (stage === null) throw new Error("no stage");
  const url = sameOriginImage(message.imageUrl);
  const data = studioSceneData(message.brand, message.design, url, message.format, message.fonts);
  const layout = parseDesign(message.design).layout;
  await stylesheetsLoaded;
  const image = await cachedImage(url);
  if (layout !== shown) {
    // Each stylesheet declares the type faces itself, so those of the sheet switched on load afresh,
    // and text measured before they are in is measured in a fallback font. Hidden meanwhile.
    stage.style.visibility = "hidden";
    for (const [name, sheet] of Object.entries(sheets)) sheet.disabled = name !== layout;
    shown = layout;
    await painted();
  }
  await loadTypeFaces(data.tokens);

  const wasPlaying = loop !== undefined;
  stopLoop();
  // Built and measured at full size: the layout reads its own boxes, which a scaled canvas would distort.
  stage.style.transform = "none";
  stage.replaceChildren();
  const scene = LAYOUTS[layout](data, image.naturalWidth / image.naturalHeight, stage);
  scene.seek(data.lengthS);
  const measured = scene.measure();
  const overflow = measured.texts.filter((t) => t.overflow || !inside(t.box, measured.safe, 1)).map((t) => t.name);
  canvas = { width: data.format.width, height: data.format.height };
  fit();
  stage.style.visibility = "";

  if (message.time === "play") {
    if (!wasPlaying) loopBegan = performance.now();
    playLoop(scene, data.lengthS);
  } else if (message.time !== "end") {
    scene.seek(Math.min(message.time, data.lengthS));
  }
  await painted();
  return overflow;
}

let waiting: SceneMessage | undefined;
let busy = false;

/** Messages are shown one at a time; while one is being built, only the newest of those that arrive is kept. */
async function drain(): Promise<void> {
  busy = true;
  for (let message = waiting; message !== undefined; message = waiting) {
    waiting = undefined;
    try {
      reply({ type: "ready", id: message.id, overflow: await show(message) });
    } catch (error) {
      stage?.style.removeProperty("visibility");
      reply({ type: "error", id: message.id, message: error instanceof Error ? error.message : "The preview could not be drawn." });
    }
  }
  busy = false;
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  const message = readMessage(event.data);
  if (message === undefined) return;
  waiting = message;
  if (!busy) void drain();
});

/** Tells the parent the page is listening; a message posted before this would be lost. */
reply({ type: "hello" });
