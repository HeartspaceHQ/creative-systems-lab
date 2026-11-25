/**
 * Where the time of a film goes: seeking the scene, rasterising and encoding one frame, and the
 * video encoder. Run alone (no render in parallel); it measures, it writes nothing but the log.
 *
 *   node src/profile-film.ts [design/campaign.json] [format] [frames]
 */
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { openScene } from "./inspect.ts";
import { FFMPEG, loadSource, run, sceneData, sha256 } from "./source.ts";

/** Frames as the stream ffmpeg reads, the same shape render.ts feeds it. */
async function* each(list: readonly Buffer[]): AsyncGenerator<Uint8Array> {
  for (const frame of list) yield await Promise.resolve(frame);
}

async function timeIt<T>(label: string, times: Map<string, number[]>, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const out = await work();
  times.set(label, [...(times.get(label) ?? []), performance.now() - started]);
  return out;
}

async function main(campaignPath: string, formatName: string, count: number): Promise<void> {
  const { tokens, campaign, assetFor } = await loadSource(campaignPath);
  const format = campaign.formats[formatName];
  const variant = campaign.variants[0];
  if (format === undefined || variant === undefined) throw new Error(`no format ${formatName}`);
  const data = sceneData(tokens, campaign, assetFor(variant, format), variant, format);
  const browser = await chromium.launch();
  const times = new Map<string, number[]>();
  const frames: Buffer[] = [];
  const fast: Buffer[] = [];
  try {
    const page: Page = await openScene(browser, campaign.page, data);
    const cdp = await page.context().newCDPSession(page);
    for (let i = 0; i < count; i++) {
      const t = (i / count) * data.lengthS;
      await timeIt("seek", times, () => page.evaluate((s) => { window.seek(s); }, t));
      frames.push(await timeIt("screenshot png (as rendered now)", times, () => page.screenshot({ type: "png", animations: "disabled" })));
      fast.push(await timeIt("screenshot png, optimizeForSpeed", times, async () => {
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
        return Buffer.from(shot.data, "base64");
      }));
      await timeIt("screenshot jpeg (raster only, for comparison)", times, () => page.screenshot({ type: "jpeg", quality: 50, animations: "disabled" }));
    }
    await page.close();
  } finally {
    await browser.close();
  }
  const decoded = async (list: readonly Buffer[]): Promise<string> => {
    const path = join(tmpdir(), `profile-film-${String(process.pid)}.rgb`);
    await run(FFMPEG, ["-loglevel", "error", "-y", "-f", "image2pipe", "-i", "-", "-f", "rawvideo", "-pix_fmt", "rgb24", path], each(list));
    const hash = sha256(await readFile(path));
    await rm(path);
    return hash;
  };
  const started = performance.now();
  await run(FFMPEG, ["-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", "30", "-i", "-", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-f", "null", "-"], each(frames));
  times.set("x264 encode (whole batch)", [performance.now() - started]);
  for (const [label, ms] of times) {
    const sum = ms.reduce((a, b) => a + b, 0);
    console.log(`${label.padEnd(48)} ${(sum / ms.length).toFixed(1).padStart(7)} ms per call, ${(sum / 1000).toFixed(2)} s total`);
  }
  console.log(`pixels identical, png vs optimizeForSpeed: ${String((await decoded(frames)) === (await decoded(fast)))}`);
}

const args = process.argv.slice(2);
await main(args[0] ?? "design/winter-morning-sunburst.json", args[1] ?? "story", Number(args[2] ?? 30));
