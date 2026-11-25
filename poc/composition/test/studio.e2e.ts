/**
 * CSL Studio's engine, end to end in real Chromium: a delivery folder rendered by studio-render, and
 * the preview page driven the way the studio's iframe drives it. The image is a generated gradient
 * with a known hash, so nothing here needs a model or a key. `npm run test:studio`.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { promisify } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { crc32, deflateSync } from "node:zlib";
import { ENGINE, sha256 } from "../src/source.ts";
import { serveDirectory } from "../src/static-server.ts";
import { writeStudioAssets } from "../src/studio-assets.ts";

const exec = promisify(execFile);

/** A warm, soft gradient as an 8-bit RGB PNG: a photograph stand-in with a known hash. */
function gradientPng(width: number, height: number): Buffer {
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * row + 1 + x * 3;
      raw[at] = 150 + Math.round((90 * x) / width);
      raw[at + 1] = 110 + Math.round((80 * y) / height);
      raw[at + 2] = 90 + Math.round((60 * (x + y)) / (width + height));
    }
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const image = gradientPng(1200, 900);
const brand = {
  id: "aster-lane-3f2a",
  name: "Aster Lane",
  colours: { ground: "#f4efe6", text: "#1d2a3a", quiet: "#5b6675", accent: "#b5542c" },
  type: { display: "Playfair Display", body: "DM Sans" },
};
const design = {
  asset: "a7f3",
  layout: "editorial",
  copy: { label: "Winter blend", headline: "Slow mornings,\nwarm hands", body: "Black tea with orange peel and clove.", cta: "asterlane.com", sender: "Aster Lane" },
  focus: { x: 0.5, y: 0.5 },
  zoom: 1,
  headline_scale: 1,
  night: 0.4,
};
const asset = { path: "assets/a7f3.png", sha256: sha256(image), approved_by: "Test", approved_for: ["render"] };

const folders: string[] = [];
const folder = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "csl-studio-"));
  folders.push(dir);
  return dir;
};
after(() => Promise.all(folders.map((dir) => rm(dir, { recursive: true, force: true }))));

async function render(dir: string): Promise<{ code: number; stderr: string }> {
  try {
    await exec("node", [join(ENGINE, "src/studio-render.ts")], { env: { ...process.env, CSL_PROJECT: dir } });
    return { code: 0, stderr: "" };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return { code: failure.code ?? -1, stderr: failure.stderr ?? "" };
  }
}

void describe("studio-render", () => {
  void it("renders every chosen size of a source.json, with every check passing", { timeout: 300_000 }, async () => {
    const dir = await folder();
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets/a7f3.png"), image);
    await writeFile(join(dir, "source.json"), JSON.stringify({ brand, design, asset, formats: ["linkedin-portrait", "linkedin-landscape"], extras: [] }));

    assert.deepEqual(await render(dir), { code: 0, stderr: "" });
    const report = JSON.parse(await readFile(join(dir, "out/studio/report.json"), "utf8")) as { checks: Record<string, { name: string; passed: boolean; detail: string }[]> };
    const failed = Object.entries(report.checks).flatMap(([group, checks]) => checks.filter((c) => !c.passed).map((c) => `${group}: ${c.name} (${c.detail})`));
    assert.deepEqual(failed, []);
    for (const file of ["design-linkedin-portrait.png", "design-linkedin-landscape.png"]) {
      assert.ok((await stat(join(dir, "out/studio", file))).size > 1000, file);
    }
    assert.ok((await stat(join(dir, "design/campaign.json"))).size > 0 && (await stat(join(dir, "assets/a7f3.json"))).size > 0);
  });

  void it("stops with a plain message and exit code 2 when the image is not the approved one", { timeout: 60_000 }, async () => {
    const dir = await folder();
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets/a7f3.png"), gradientPng(200, 150));
    await writeFile(join(dir, "source.json"), JSON.stringify({ brand, design, asset, formats: ["story"], extras: [] }));
    const result = await render(dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /studio-render: .*does not match the approved one/);
  });

  void it("names the field of a design that is refused", { timeout: 60_000 }, async () => {
    const dir = await folder();
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets/a7f3.png"), image);
    await writeFile(join(dir, "source.json"), JSON.stringify({ brand, design: { ...design, zoom: 9 }, asset, formats: ["story"], extras: [] }));
    const result = await render(dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /^studio-render: zoom: Use a number from 0.5 to 2\.$/m);
  });
});

interface Reply {
  readonly type: string;
  readonly id?: unknown;
  readonly overflow?: readonly string[];
  readonly message?: string;
}

/** A reply without its absent fields (a message without an id is answered without one). */
const summary = (reply: Reply): Reply => Object.fromEntries(Object.entries(reply).filter(([, value]) => value !== undefined)) as unknown as Reply;

/** Posts a scene message to the preview page and returns its answer (the page is its own parent here). */
function ask(page: Page, message: object): Promise<Reply> {
  return page.evaluate((m) => new Promise<Reply>((resolve) => {
    const listener = (event: MessageEvent<Reply>): void => {
      if (event.data.type !== "ready" && event.data.type !== "error") return;
      removeEventListener("message", listener);
      resolve(event.data);
    };
    addEventListener("message", listener);
    postMessage(m, location.origin);
  }), message);
}

void describe("the preview page", () => {
  void it("builds either layout in place, reports overflow and refuses what it should", { timeout: 120_000 }, async () => {
    const dir = await folder();
    await writeStudioAssets(dir);
    await writeFile(join(dir, "photo.png"), image);
    const served = await serveDirectory(dir);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 540, height: 675 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${served.url}studio.html`);
      const scene = (layout: string, format: string, extra: object = {}): object => ({
        type: "scene", brand, design: { ...design, layout }, imageUrl: "photo.png", format, ...extra,
      });

      assert.deepEqual(summary(await ask(page, scene("editorial", "linkedin-portrait"))), { type: "ready", overflow: [] });
      assert.deepEqual(summary(await ask(page, scene("cinema", "linkedin-landscape", { id: 7, time: 3 }))), { type: "ready", id: 7, overflow: [] });
      // Back to the first layout: its type faces load afresh, and the headline is measured in the real one.
      const wide = await ask(page, scene("editorial", "wide"));
      assert.deepEqual(summary(wide), { type: "ready", overflow: [] });
      const box = await page.evaluate(() => {
        const rect = document.querySelector(".headline")?.getBoundingClientRect();
        return rect === undefined ? undefined : { right: rect.right, width: rect.width };
      });
      assert.ok(box !== undefined && box.right <= 540, "the headline of the wide canvas lies inside the frame");

      const long = await ask(page, scene("editorial", "linkedin-portrait", { design: { ...design, copy: { ...design.copy, headline: "Aa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cc" } } }));
      assert.deepEqual(long.overflow, ["headline"]);

      assert.match((await ask(page, scene("cinema", "wide", { imageUrl: "missing.png" }))).message ?? "", /did not load/);
      assert.equal((await ask(page, scene("cinema", "wide", { imageUrl: "https://example.com/x.png" }))).type, "error");
      assert.equal((await ask(page, scene("cinema", "poster"))).type, "error");
      const bad = await ask(page, scene("cinema", "wide", { brand: { ...brand, colours: { ...brand.colours, ground: "white" } }, id: "x" }));
      assert.deepEqual(summary(bad), { type: "error", id: "x", message: "Use a colour like #1d2a3a." });
      assert.deepEqual(summary(await ask(page, scene("cinema", "linkedin-square"))), { type: "ready", overflow: [] });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await served.close();
    }
  });
});

void describe("the preview inside an iframe", () => {
  const host = (frame: string): string => `<!doctype html><meta charset="utf-8"><iframe id="f" src="${frame}" width="540" height="675"></iframe>`;

  void it("answers its parent on the same origin and ignores a parent on another", { timeout: 120_000 }, async () => {
    const dir = await folder();
    await writeStudioAssets(dir);
    await writeFile(join(dir, "photo.png"), image);
    const other = await folder();
    const studio = await serveDirectory(dir);
    const stranger = await serveDirectory(other);
    await writeFile(join(dir, "host.html"), host("studio.html"));
    await writeFile(join(other, "host.html"), host(`${studio.url}studio.html`));
    const browser = await chromium.launch();
    const message = { type: "scene", brand, design, imageUrl: "photo.png", format: "story" };
    /** Everything the iframe says to its parent in the seconds after the message. */
    const heard = (page: Page, target: string): Promise<Reply[]> => page.evaluate(async ([m, to]) => {
      const replies: Reply[] = [];
      addEventListener("message", (event: MessageEvent<Reply>) => { replies.push(event.data); });
      const frame = document.getElementById("f") as HTMLIFrameElement;
      frame.contentWindow?.postMessage(m, to);
      await new Promise((done) => setTimeout(done, 2500));
      return replies;
    }, [message, target] as const);
    try {
      const page = await browser.newPage();
      await page.goto(`${studio.url}host.html`);
      const own = await heard(page, studio.url.replace(/\/$/, ""));
      assert.deepEqual(own.map((r) => r.type), ["ready"]);

      await page.goto(`${stranger.url}host.html`);
      assert.deepEqual(await heard(page, "*"), [], "a page from another origin gets no answer");
    } finally {
      await browser.close();
      await studio.close();
      await stranger.close();
    }
  });
});

