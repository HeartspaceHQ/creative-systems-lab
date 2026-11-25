/**
 * Measures the exported web page as a visitor's browser loads and plays it, not by file sizes alone.
 *
 *   node src/web-perf.ts [design/campaign.json] [--runs 3]
 *
 * Run after render.ts (for the film) and web-export.ts. Each run is a cold load in a fresh browser
 * context, served over HTTP from 127.0.0.1 with Brotli, as a static host would.
 *  - phone: 390×844 at 3× density, DevTools throttling as Lighthouse applies it for "Slow 4G"
 *    (562,5 ms round trip, 1,47 Mbit/s down) and a CPU slowed four times;
 *  - desktop: 1440×900 at 2× density, no throttling.
 * The same screens load two pages made from the rendered film for comparison: a web-encoded MP4 and
 * the GIF. Reports the median of the runs: first contentful paint, largest contentful paint, when
 * the scene (or the film's first frame) is ready, bytes over the wire and requests, then frame times
 * while the page scrolls (scene) or plays (film).
 *
 * Limits: this is an Apple-silicon Mac slowing itself down, not a phone. GPU, memory and thermals are
 * the Mac's; the numbers compare the pages with each other, they do not predict a given phone.
 * Frame times are requestAnimationFrame intervals on the main thread: work the compositor does
 * after a frame is handed over (rasterising, compositing the photograph) is not in them.
 * Bytes count everything the page fetched until the network was idle again after the frame window.
 */
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type CDPSession } from "@playwright/test";
import { FFMPEG, loadSource, PROJECT, run } from "./source.ts";
import { serveDirectory } from "./static-server.ts";

interface Screen {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Mobile viewport and touch, as a phone browser reports them. */
  readonly mobile: boolean;
  readonly throttle: boolean;
  /** The rendered format whose film stands in for this screen. */
  readonly format: string;
}

const SCREENS: readonly Screen[] = [
  { name: "phone", width: 390, height: 844, dpr: 3, mobile: true, throttle: true, format: "story" },
  { name: "desktop", width: 1440, height: 900, dpr: 2, mobile: false, throttle: false, format: "landscape" },
];

/** Lighthouse's DevTools throttling for mobile ("Slow 4G" with its request-level adjustment). */
const NETWORK = { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 };
const CPU_SLOWDOWN = 4;
/** How long frames are timed, and the scroll speed while they are: a steady, unhurried thumb. */
const FRAME_WINDOW_MS = 4000;
const SCROLL_PX_PER_S = 600;
/** Long enough for the GIF over the throttled network (26 MB at 1,47 Mbit/s is about 140 s): measured, not cut off. */
const PAGE_TIMEOUT_MS = 300_000;
/**
 * Headless Chromium rasterises in software (SwiftShader) by default. Every phone has a GPU, so the
 * page is measured on the Mac's: in software the scene's full-frame blend layers cost 33 ms a frame
 * at 1440×900, on the GPU 16,7 ms (measured 2026-11-22).
 */
const GPU_ARGS = ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"];

async function rendererName(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  const name = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info === undefined || info === null || gl === null ? "unknown" : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  });
  await page.close();
  return name;
}

/** A frame longer than this is visibly late at 60 Hz. */
const LATE_FRAME_MS = 25;

interface Run {
  readonly fcp: number | null;
  readonly lcp: number | null;
  readonly ready: number | null;
  readonly bytes: number;
  readonly requests: number;
  readonly frameP50: number;
  readonly frameP95: number;
  readonly lateFrames: number;
  readonly frames: number;
  /** Share of the frame window the page's main thread was busy (CDP TaskDuration), at the screen's CPU speed. */
  readonly cpuBusy: number;
  /** JavaScript heap in use after the scroll, in bytes (CDP JSHeapUsedSize). Decoded images are not in it. */
  readonly heap: number;
  /** DOM nodes in the document after the scroll. */
  readonly nodes: number;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? NaN) : ((s[mid - 1] ?? NaN) + (s[mid] ?? NaN)) / 2;
};

const medianOrNull = (xs: readonly (number | null)[]): number | null => {
  const known = xs.filter((x): x is number => x !== null);
  return known.length === xs.length ? median(known) : null;
};

/** Page side: the paint timings and the readiness mark, once the page has settled. */
function timings(): Promise<{ fcp: number | null; lcp: number | null; ready: number | null }> {
  return new Promise((resolve) => {
    let lcp: number | null = null;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    setTimeout(() => {
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
      const ready = performance.getEntriesByName("scene-ready")[0]?.startTime ?? null;
      resolve({ fcp, lcp, ready });
    }, 50);
  });
}

/** Page side: frame intervals over a window, scrolling at a steady speed when asked. */
function frameTimes(arg: { readonly ms: number; readonly pxPerS: number; readonly scroll: boolean }): Promise<number[]> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let first = -1;
    let last = -1;
    const tick = (now: number): void => {
      if (first < 0) first = now;
      if (last >= 0) deltas.push(now - last);
      last = now;
      if (arg.scroll) window.scrollTo(0, ((now - first) / 1000) * arg.pxPerS);
      if (now - first < arg.ms) requestAnimationFrame(tick);
      else resolve(deltas);
    };
    requestAnimationFrame(tick);
  });
}

/** A Chromium performance counter: TaskDuration is seconds of main-thread work so far (script, style, layout, paint). */
async function metric(cdp: CDPSession, name: "TaskDuration" | "JSHeapUsedSize" | "Nodes"): Promise<number> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const found = metrics.find((m) => m.name === name);
  if (found === undefined) throw new Error(`Chromium reported no ${name}`);
  return found.value;
}

async function measure(browser: Browser, url: string, screen: Screen, scroll: boolean): Promise<Run> {
  const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, deviceScaleFactor: screen.dpr, isMobile: screen.mobile, hasTouch: screen.mobile });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  let bytes = 0;
  let requests = 0;
  const inFlight = new Set<string>();
  cdp.on("Network.requestWillBeSent", (e) => { inFlight.add(e.requestId); });
  cdp.on("Network.loadingFailed", (e) => { inFlight.delete(e.requestId); });
  cdp.on("Network.loadingFinished", (e) => {
    inFlight.delete(e.requestId);
    bytes += e.encodedDataLength;
    requests++;
  });
  /** No request open for half a second, within a minute. Playwright's networkidle only fires once, at load. */
  const settled = async (): Promise<void> => {
    for (let quiet = 0, waited = 0; quiet < 5; quiet = inFlight.size === 0 ? quiet + 1 : 0, waited++) {
      if (waited > 600) throw new Error(`${url}: the network never went quiet`);
      await page.waitForTimeout(100);
    }
  };
  if (screen.throttle) {
    await cdp.send("Network.emulateNetworkConditions", NETWORK);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  }
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
  await page.waitForFunction(() => performance.getEntriesByName("scene-ready").length > 0, undefined, { timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle");
  if (errors.length > 0) throw new Error(`${url}: ${errors.join("; ")}`);
  const t = await page.evaluate(timings);
  await cdp.send("Performance.enable");
  const busyBefore = await metric(cdp, "TaskDuration");
  const wallBefore = performance.now();
  const deltas = await page.evaluate(frameTimes, { ms: FRAME_WINDOW_MS, pxPerS: SCROLL_PX_PER_S, scroll });
  const cpuBusy = (await metric(cdp, "TaskDuration") - busyBefore) / ((performance.now() - wallBefore) / 1000);
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await metric(cdp, "JSHeapUsedSize");
  const nodes = await metric(cdp, "Nodes");
  // Anything the scroll asked for (a larger photograph, say) is counted before the page closes.
  await settled();
  await context.close();
  if (deltas.length === 0) throw new Error(`${url}: no frames were timed`);
  return {
    ...t,
    bytes,
    requests,
    frameP50: median(deltas),
    frameP95: [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length * 0.95)] ?? NaN,
    lateFrames: deltas.filter((d) => d > LATE_FRAME_MS).length / deltas.length,
    frames: deltas.length,
    cpuBusy,
    heap,
    nodes,
  };
}

/** A page that shows the rendered film the plain way, for comparison: no text but what is in the pixels. */
function filmPage(title: string, media: string): string {
  const tag = media.endsWith(".mp4")
    ? `<video src="${media}" autoplay muted playsinline loop preload="auto"></video>`
    : `<img src="${media}" alt="">`;
  const ready = media.endsWith(".mp4")
    ? `document.querySelector("video").requestVideoFrameCallback(() => performance.mark("scene-ready"));`
    : `const img = document.querySelector("img"); img.decode().then(() => performance.mark("scene-ready"));`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>html,body{margin:0;background:#1c1714}video,img{display:block;width:100vw;height:100svh;object-fit:cover}</style>
</head><body>${tag}<script>${ready}</script></body></html>
`;
}

async function main(campaignPath: string, runs: number): Promise<void> {
  const { campaign } = await loadSource(campaignPath);
  const variant = campaign.variants[0]?.id;
  if (variant === undefined) throw new Error("the campaign has no variant");
  const out = join(PROJECT, "out", campaign.id);
  const compareDir = join(out, "web-compare");
  await mkdir(compareDir, { recursive: true });

  // The comparison pages, from the film render.ts made: an MP4 encoded for the web, and the GIF.
  for (const screen of SCREENS) {
    const name = `${variant}-${screen.format}`;
    const width = screen.name === "phone" ? 720 : 1280;
    await run(FFMPEG, ["-loglevel", "error", "-y", "-i", join(out, `${name}.mp4`), "-vf", `scale=${String(width)}:-2:flags=lanczos`,
      "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", "-map_metadata", "-1",
      join(compareDir, `${name}-web.mp4`)]);
    await copyFile(join(out, `${name}.gif`), join(compareDir, `${name}.gif`));
    await writeFile(join(compareDir, `mp4-${screen.name}.html`), filmPage("MP4 comparison", `${name}-web.mp4`));
    await writeFile(join(compareDir, `gif-${screen.name}.html`), filmPage("GIF comparison", `${name}.gif`));
  }

  const scene = await serveDirectory(join(out, "web"));
  const films = await serveDirectory(compareDir);
  const browser = await chromium.launch({ args: GPU_ARGS });
  const gpu = await rendererName(browser);
  console.log(`rasteriser: ${gpu}`);
  if (gpu.includes("SwiftShader")) throw new Error("no GPU: frame times would measure software rasterising, not a phone");
  const results: Record<string, Record<string, Run & { runs: number }>> = {};
  try {
    for (const screen of SCREENS) {
      const pages: readonly (readonly [string, string, boolean])[] = [
        ["scene (web export)", scene.url, true],
        ["MP4 page", `${films.url}mp4-${screen.name}.html`, false],
        ["GIF page", `${films.url}gif-${screen.name}.html`, false],
      ];
      results[screen.name] = {};
      for (const [label, url, scroll] of pages) {
        const all: Run[] = [];
        for (let i = 0; i < runs; i++) all.push(await measure(browser, url, screen, scroll));
        const m: Run & { runs: number } = {
          fcp: medianOrNull(all.map((r) => r.fcp)),
          lcp: medianOrNull(all.map((r) => r.lcp)),
          ready: medianOrNull(all.map((r) => r.ready)),
          bytes: median(all.map((r) => r.bytes)),
          requests: median(all.map((r) => r.requests)),
          frameP50: median(all.map((r) => r.frameP50)),
          frameP95: median(all.map((r) => r.frameP95)),
          lateFrames: median(all.map((r) => r.lateFrames)),
          frames: median(all.map((r) => r.frames)),
          cpuBusy: median(all.map((r) => r.cpuBusy)),
          heap: median(all.map((r) => r.heap)),
          nodes: median(all.map((r) => r.nodes)),
          runs,
        };
        results[screen.name] = { ...results[screen.name], [label]: m };
        const ms = (x: number | null): string => (x === null ? "n/a" : `${String(Math.round(x))} ms`);
        console.log(`${screen.name.padEnd(8)} ${label.padEnd(19)} FCP ${ms(m.fcp).padStart(8)}  LCP ${ms(m.lcp).padStart(8)}  ready ${ms(m.ready).padStart(8)}  `
          + `${(m.bytes / 1000).toFixed(1).padStart(7)} kB in ${String(m.requests).padStart(2)} requests  `
          + `frames p50 ${m.frameP50.toFixed(1)} ms, p95 ${m.frameP95.toFixed(1)} ms, ${(m.lateFrames * 100).toFixed(1)} % over ${String(LATE_FRAME_MS)} ms, main thread ${(m.cpuBusy * 100).toFixed(0)} % busy, `
          + `JS heap ${(m.heap / 1e6).toFixed(1)} MB, ${String(Math.round(m.nodes))} DOM nodes`);
      }
    }
  } finally {
    await browser.close();
    await scene.close();
    await films.close();
  }
  await writeFile(join(out, "web-perf.json"), JSON.stringify({
    measured: new Date().toISOString(),
    method: { gpu, runs, screens: SCREENS, network: NETWORK, cpuSlowdown: CPU_SLOWDOWN, frameWindowMs: FRAME_WINDOW_MS, scrollPxPerS: SCROLL_PX_PER_S, lateFrameMs: LATE_FRAME_MS },
    host: "Apple-silicon Mac, headless Chromium (Playwright); a slowed Mac, not a phone",
    results,
  }, null, 2));
}

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 3;
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs needs a whole number of at least 1");
await main(args.find((a, i) => !a.startsWith("--") && (runsAt < 0 || i !== runsAt + 1)) ?? "design/campaign.json", runs);
