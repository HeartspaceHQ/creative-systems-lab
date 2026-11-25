/**
 * Looking at a running scene from outside: open it, take frames, read pixels behind the text.
 * Shared by the renderer and the web export's verification. Node only (Playwright).
 */
import type { Browser, CDPSession, Page } from "@playwright/test";
import { overlapsImage, stageReadings, type Backdrop, type StageReading } from "./checks.ts";
import { serve } from "./source.ts";
import type { Box, Measurement, SceneData } from "./types.ts";

export const ORIGIN = "https://scene.invalid/";

export async function openScene(browser: Browser, page: string, data: SceneData): Promise<Page> {
  const tab = await browser.newPage({ viewport: { width: data.format.width, height: data.format.height }, deviceScaleFactor: 1 });
  await tab.route("**/*", async (route) => {
    const served = route.request().url().startsWith(ORIGIN) ? await serve(route.request().url()) : undefined;
    await (served === undefined ? route.abort() : route.fulfill({ status: 200, ...served }));
  });
  await tab.addInitScript((d: SceneData) => {
    window.__DATA = d;
    window.__RENDER = true;
  }, data);
  const errors: string[] = [];
  tab.on("pageerror", (e) => errors.push(e.message));
  tab.on("requestfailed", (r) => errors.push(`not served: ${r.url()}`));
  try {
    await tab.goto(ORIGIN + page);
    await tab.waitForFunction(() => window.KLAR, undefined, { timeout: 15_000 });
  } catch {
    await tab.close();
    throw new Error(`scene did not become ready: ${errors.join("; ")}`);
  }
  return tab;
}

export async function still(page: Page, t?: number): Promise<Buffer> {
  await page.evaluate((time) => { window.seek(time ?? window.LANGD); }, t);
  return page.screenshot({ type: "png", animations: "disabled" });
}

/**
 * One film frame at t. The same pixels as still(), but the PNG is compressed for speed, not size:
 * the encoder decodes it at once. Profiling showed Chromium's default PNG compression was 85 % of
 * the film's time (455 ms of 530 ms per frame); this takes 76 ms (src/profile-film.ts).
 */
export async function frame(page: Page, cdp: CDPSession, t: number): Promise<Buffer> {
  await page.evaluate((time) => { window.seek(time); }, t);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
  return Buffer.from(shot.data, "base64");
}

export interface PixelSummary {
  /** Mean sRGB value of the whole frame, 0..255 per channel. */
  readonly mean: readonly [number, number, number];
  readonly boxes: readonly { readonly p5: number; readonly p95: number }[];
}

/**
 * Runs in the page: decode a screenshot and summarise its pixels. Self-contained because Playwright
 * serialises it; the luminance formula is the WCAG one also used in checks.ts.
 */
async function summarisePixels(arg: { readonly src: string; readonly boxes: readonly Box[] }): Promise<PixelSummary> {
  const img = new Image();
  img.src = arg.src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const all = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < all.length; i += 4) {
    for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (all[i + c] ?? 0);
  }
  const n = all.length / 4;
  const boxes = arg.boxes.map((box) => {
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(box.w)));
    const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(box.h)));
    const d = ctx.getImageData(x, y, w, h).data;
    const lum: number[] = [];
    for (let i = 0; i < d.length; i += 4) {
      lum.push(0.2126 * lin(d[i] ?? 0) + 0.7152 * lin(d[i + 1] ?? 0) + 0.0722 * lin(d[i + 2] ?? 0));
    }
    lum.sort((a, b) => a - b);
    return { p5: lum[Math.floor(lum.length * 0.05)] ?? 0, p95: lum[Math.floor(lum.length * 0.95)] ?? 0 };
  });
  return { mean: [(sum[0] ?? 0) / n, (sum[1] ?? 0) / n, (sum[2] ?? 0) / n], boxes };
}

export async function pixels(page: Page, png: Buffer, boxes: readonly Box[]): Promise<PixelSummary> {
  return page.evaluate(summarisePixels, { src: `data:image/png;base64,${png.toString("base64")}`, boxes });
}

/** The frame with every text layer hidden: what the words actually sit on. */
export async function backdrop(page: Page): Promise<Buffer> {
  const layers = (visibility: string): Promise<void> =>
    page.evaluate((v) => {
      document.querySelectorAll<HTMLElement>("[data-lager='text']").forEach((el) => { el.style.visibility = v; });
    }, visibility);
  await layers("hidden");
  const png = await page.screenshot({ type: "png", animations: "disabled" });
  await layers("visible");
  return png;
}

/** Warmth of a frame: how far red leads blue on average, in 0..255 units. Above 0 the frame reads warm. */
export const warmth = (summary: PixelSummary): number => summary.mean[0] - summary.mean[2];

/** Seconds between the frames sampled for legibility. */
const LEGIBILITY_STEP_S = 0.5;

/**
 * Contrast of every fully shown text on a stage image, sampled through the whole film and the end
 * state. Text that is still fading in is skipped: it is in transition, not being read.
 */
/** The texts that sit on a stage photograph in the end state: each must have legibility readings. */
export const stageTexts = (m: Measurement): string[] =>
  m.texts.filter((x) => m.images.some((i) => i.kind === "rect" && i.stage === true && overlapsImage(x.box, i))).map((x) => x.name);

export async function legibilityOverTime(page: Page): Promise<StageReading[]> {
  const length = await page.evaluate(() => window.LANGD);
  const times = Array.from({ length: Math.floor(length / LEGIBILITY_STEP_S) + 1 }, (_, i) => i * LEGIBILITY_STEP_S);
  const readings: StageReading[] = [];
  for (const t of [...times, length]) {
    await page.evaluate((time) => { window.seek(time); }, t);
    const m = await page.evaluate(() => window.measure());
    const onStage = m.texts.filter((x) => x.opacity >= 0.98 && m.images.some((i) => i.kind === "rect" && i.stage === true && overlapsImage(x.box, i)));
    if (onStage.length === 0) continue;
    const summary = await pixels(page, await backdrop(page), onStage.map((x) => x.box));
    const backdrops: Backdrop[] = onStage.map((x, i) => ({ name: x.name, p5: summary.boxes[i]?.p5 ?? 0, p95: summary.boxes[i]?.p95 ?? 1 }));
    readings.push(...stageReadings(m, backdrops, t));
  }
  await page.evaluate(() => { window.seek(window.LANGD); });
  return readings;
}
