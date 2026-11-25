/**
 * Verifies the exported web page against the renderer and on real screen sizes.
 *
 *   node src/web-check.ts [design/campaign.json]
 *
 * Run after render.ts and web-export.ts. The page is served over HTTP from 127.0.0.1.
 *  1. Equivalence: at each campaign format's size, the web page's end state against the renderer's
 *     still. Text layout must match exactly; pixels are compared and the difference is split into
 *     its two known causes, the static grain tile and WebP compression.
 *  2. Screens: phone, tablet and desktop sizes. The renderer's own layout checks and legibility over
 *     time run on the live page, and the photograph must be the one directed for the screen's shape.
 *  3. Reduced motion, the time-driven mode, the opening, the accessible text, and what a visitor
 *     sees when something fails: no JavaScript, no fonts, no photograph, no scene module.
 * Every page load also asserts that the page asks nothing of any host but its own.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { renderChecks, stageChecks, type Check } from "./checks.ts";
import { legibilityOverTime, openScene, stageTexts, still } from "./inspect.ts";
import { shapeOf } from "./shape.ts";
import { loadSource, pickVariant, resolveVariant, PROJECT, sceneData, sceneModule } from "./source.ts";
import { serveDirectory } from "./static-server.ts";
import type { Measurement, WebScene } from "./types.ts";

/** Screens beyond the campaign formats: common phones, a tablet, laptops and a square-ish desktop. */
const SCREENS: readonly (readonly [string, number, number])[] = [
  ["phone 390×844", 390, 844],
  ["small phone 360×640", 360, 640],
  ["tablet 820×1180", 820, 1180],
  ["laptop 1440×900", 1440, 900],
  ["desktop 1920×1080", 1920, 1080],
  ["desktop 1280×1024", 1280, 1024],
];

/** A moment mid-film where light, push and steeping are all still moving. */
const MID_FILM_S = 5;
/** Long enough for the opening that plays by itself to finish. */
const INTRO_WAIT_MS = 2200;

/** Grain and WebP move single pixels a little; a layout, timing or colour fault moves many a lot. */
const matches = (d: PixelDiff): boolean => d.mean < 3 && d.visible < 0.01;
const describe = (label: string, d: PixelDiff): string =>
  `${label}: mean ${d.mean.toFixed(2)}/255, ${(d.visible * 100).toFixed(2)} % visibly different, PSNR ${d.psnr.toFixed(1)} dB`;

/** Largest difference in CSS pixels allowed between the renderer's and the page's text boxes. */
const LAYOUT_SLACK_PX = 0.5;

interface PixelDiff {
  /** Mean absolute difference per channel, 0..255. */
  readonly mean: number;
  /** Share of pixels where some channel differs by more than 16 of 255. */
  readonly visible: number;
  readonly psnr: number;
}

/** Runs in the page: compare two same-sized PNGs. */
async function comparePixels(arg: { readonly a: string; readonly b: string }): Promise<PixelDiff> {
  const read = async (src: string): Promise<Uint8ClampedArray> => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const [a, b] = await Promise.all([read(arg.a), read(arg.b)]);
  if (a.length !== b.length) throw new Error("images differ in size");
  let sum = 0;
  let squares = 0;
  let visible = 0;
  for (let i = 0; i < a.length; i += 4) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0));
      sum += d;
      squares += d * d;
      worst = Math.max(worst, d);
    }
    if (worst > 16) visible++;
  }
  const n = a.length / 4;
  const mse = squares / (n * 3);
  return { mean: sum / (n * 3), visible: visible / n, psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse) };
}

const dataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString("base64")}`;

/** Requests the page made to any other host than the local server. A published page must make none. */
const foreign: string[] = [];

interface OpenOptions {
  readonly reduced?: boolean;
  readonly dpr?: number;
  readonly script?: boolean;
  /** Requests whose path ends like this fail, as a network error would. */
  readonly fail?: readonly string[];
  /** What to wait for: the scene's ready flag (default), or a selector for a page without one. */
  readonly ready?: string;
  /** Collects the path of every request the page makes on its own origin. */
  readonly requested?: string[];
}

async function openWeb(browser: Browser, url: string, w: number, h: number, options: OpenOptions = {}): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: options.dpr ?? 1,
    reducedMotion: options.reduced === true ? "reduce" : "no-preference",
    javaScriptEnabled: options.script ?? true,
  });
  const page = await context.newPage();
  const origin = new URL(url).origin;
  await page.route("**/*", async (route) => {
    const target = route.request().url();
    // A request still open when the page closes is dropped, not an error of the check.
    const settle = (done: Promise<void>): Promise<void> => done.catch(() => undefined);
    if (!target.startsWith("data:") && new URL(target).origin !== origin) {
      foreign.push(target);
      await settle(route.abort());
    } else if ((options.fail ?? []).some((end) => new URL(target).pathname.endsWith(end))) {
      await settle(route.abort("failed"));
    } else {
      options.requested?.push(new URL(target).pathname);
      await settle(route.continue());
    }
  });
  // Each page has its own context; it goes with the page. The browser may already be closing it.
  page.on("close", () => { context.close().catch(() => undefined); });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  const ready = options.ready;
  await (ready === undefined
    ? page.waitForFunction(() => window.KLAR, undefined, { timeout: 15_000 })
    : page.waitForSelector(ready, { state: "attached", timeout: 15_000 })
  ).catch(() => {
    throw new Error(`web page did not become ready: ${errors.join("; ")}`);
  });
  return page;
}

/** The source width a page chose, from the photograph's file name. */
const chosenWidth = (href: string): number => Number(/-(\d+)\.webp$/.exec(href)?.[1] ?? NaN);

function layoutMatches(name: string, render: Measurement, web: Measurement): Check {
  let worst = 0;
  const missing: string[] = [];
  for (const r of render.texts) {
    const w = web.texts.find((x) => x.name === r.name);
    if (w?.fontSizePx !== r.fontSizePx) {
      missing.push(r.name);
      continue;
    }
    worst = Math.max(worst, Math.abs(w.box.x - r.box.x), Math.abs(w.box.y - r.box.y), Math.abs(w.box.w - r.box.w), Math.abs(w.box.h - r.box.h));
  }
  return {
    name: `${name}: text layout matches the renderer`,
    passed: render.texts.length > 0 && missing.length === 0 && worst <= LAYOUT_SLACK_PX && web.texts.length === render.texts.length,
    detail: `${String(render.texts.length)} texts, largest box difference ${worst.toFixed(2)} px${missing.length > 0 ? `, differs: ${missing.join(", ")}` : ""}`,
  };
}

/** The technical section on a 360 px phone, and its scrubber at the start and end of the film. */
async function explainerChecks(browser: Browser, url: string, lengthS: number): Promise<Check[]> {
  const page = await openWeb(browser, url, 360, 640);
  await page.locator(".demo-stage").scrollIntoViewIfNeeded();
  const built = await page.waitForSelector(".demo-stage .scene", { timeout: 10_000 }).then(() => true, () => false);
  const lineOffset = async (t: number): Promise<number> => {
    await page.locator("#demo-t").fill(String(t));
    return page.evaluate(() => {
      const line = document.querySelector<HTMLElement>(".demo-stage .headline .line");
      return line === null ? Number.NaN : new DOMMatrix(getComputedStyle(line).transform).m42 / line.offsetHeight;
    });
  };
  const atStart = await lineOffset(0);
  const atEnd = await lineOffset(lengthS);
  const facts = await page.evaluate(() => ({
    h2: document.querySelector(".explainer h2")?.textContent ?? "",
    rows: document.querySelectorAll(".explainer .facts dd").length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    smallest: Math.min(...[...document.querySelectorAll<HTMLElement>(".explainer p, .explainer dd, .explainer li")].map((el) => parseFloat(getComputedStyle(el).fontSize))),
    stage: document.querySelectorAll(".stage .scene").length,
  }));
  await page.close();
  return [
    { name: "technical section present with facts from the render", passed: facts.h2.length > 0 && facts.rows > 10, detail: `"${facts.h2}", ${String(facts.rows)} facts` },
    { name: "technical section fits a 360 px phone", passed: facts.overflow <= 0 && facts.smallest >= 13, detail: `${String(facts.overflow)} px wider than the screen, smallest text ${String(facts.smallest)} px` },
    { name: "scrubber draws the same scene at the chosen moment", passed: built && atStart > 0.5 && Math.abs(atEnd) < 0.01 && facts.stage === 1, detail: `headline line ${(atStart * 100).toFixed(0)} % below at 0 s, ${(atEnd * 100).toFixed(1)} % at ${String(lengthS)} s` },
  ];
}

async function main(campaignPath: string, variantId: string | undefined): Promise<void> {
  const { tokens, campaign, assetFor } = await loadSource(campaignPath);
  // The same variant the page was exported for (web-export --variant), else the first.
  const variant = pickVariant(campaign, variantId);
  // What the page shows: the variant's copy and length over the campaign's.
  const { copy, lengthS } = resolveVariant(tokens, campaign, variant);
  const steepText = copy.steep === undefined ? "" : `${String(copy.steep.minutes)} min · ${String(copy.steep.temperature_c)} °C`;
  const sceneFile = `/${await sceneModule(campaign.page)}.js`;
  const webDir = join(PROJECT, "out", campaign.id, "web");
  const compareDir = join(PROJECT, "out", campaign.id, "web-check");
  await mkdir(compareDir, { recursive: true });
  const served = await serveDirectory(webDir);
  const browser = await chromium.launch();
  const report: Record<string, Check[]> = {};
  const diffs: Record<string, Record<string, PixelDiff>> = {};
  const log = (group: string, checks: readonly Check[]): void => {
    report[group] = [...(report[group] ?? []), ...checks];
    for (const c of checks) console.log(`${c.passed ? "ok  " : "FAIL"} ${c.name}  ${c.detail}`);
  };
  const directedFor = (w: number, h: number): string => {
    const shape = shapeOf(w, h);
    const format = Object.values(campaign.formats).find((f) => shapeOf(f.width, f.height) === shape);
    if (format === undefined) throw new Error(`no format for ${shape}`);
    return assetFor(variant, format).source.candidate_id;
  };

  try {
    // 1. Equivalence with the deterministic export.
    for (const [formatName, format] of Object.entries(campaign.formats)) {
      const data = sceneData(tokens, campaign, assetFor(variant, format), variant, format);
      const rendered = await openScene(browser, campaign.page, data);
      const renderPng = await still(rendered);
      const renderMeasure = await rendered.evaluate(() => window.measure());
      await rendered.close();
      const staticGrain = await openScene(browser, campaign.page, { ...data, medium: "web" });
      const staticPng = await still(staticGrain);
      const staticMid = await still(staticGrain, MID_FILM_S);
      await staticGrain.close();

      const web = await openWeb(browser, served.url, format.width, format.height, { reduced: true });
      const webMeasure = await web.evaluate(() => window.measure());
      const webPng = await web.screenshot({ type: "png", animations: "disabled" });
      const diff = {
        "renderer vs web page": await web.evaluate(comparePixels, { a: dataUrl(renderPng), b: dataUrl(webPng) }),
        "grain only (film grain vs static tile, same PNG)": await web.evaluate(comparePixels, { a: dataUrl(renderPng), b: dataUrl(staticPng) }),
        "image only (PNG vs WebP, same static grain)": await web.evaluate(comparePixels, { a: dataUrl(staticPng), b: dataUrl(webPng) }),
      };
      await web.close();
      diffs[formatName] = diff;
      await writeFile(join(compareDir, `${formatName}-render.png`), renderPng);
      await writeFile(join(compareDir, `${formatName}-web.png`), webPng);
      const whole = diff["renderer vs web page"];
      log("equivalence", [
        layoutMatches(formatName, renderMeasure, webMeasure),
        {
          name: `${formatName}: end state matches the renderer's still`,
          // Grain and WebP move single pixels a little; a layout or colour fault moves many a lot.
          passed: matches(whole),
          detail: Object.entries(diff).map(([k, d]) => describe(k, d)).join("; "),
        },
      ]);

      // Mid-film, driven by scroll as a visitor would: the frame at MID_FILM_S must be the renderer's.
      const scrolling = await openWeb(browser, served.url, format.width, format.height);
      await scrolling.waitForTimeout(INTRO_WAIT_MS);
      await scrolling.evaluate((t) => {
        const film = document.querySelector<HTMLElement>(".film");
        if (film === null) throw new Error("no film");
        window.scrollTo(0, (t / window.LANGD) * (film.offsetHeight - window.innerHeight));
      }, MID_FILM_S);
      await scrolling.evaluate(() => new Promise((done) => { requestAnimationFrame(() => { requestAnimationFrame(done); }); }));
      const midPng = await scrolling.screenshot({ type: "png", animations: "disabled" });
      const mid = await scrolling.evaluate(comparePixels, { a: dataUrl(staticMid), b: dataUrl(midPng) });
      await scrolling.close();
      await writeFile(join(compareDir, `${formatName}-web-${String(MID_FILM_S)}s.png`), midPng);
      log("equivalence", [{ name: `${formatName}: scrolled to ${String(MID_FILM_S)} s matches the renderer's frame`, passed: matches(mid), detail: describe("renderer (static grain) vs scrolled page", mid) }]);
    }

    // 2. Real screens: the renderer's checks on the live page.
    for (const [name, w, h] of SCREENS) {
      const requested: string[] = [];
      const page = await openWeb(browser, served.url, w, h, { requested });
      const expected = directedFor(w, h);
      const images = requested.filter((path) => path.includes("/img/"));
      const href = await page.evaluate(() => document.querySelector(".scene image")?.getAttribute("href") ?? "");
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const checks: Check[] = [
        { name: `${name}: photograph directed for ${shapeOf(w, h)}`, passed: href.includes(expected), detail: href.split("/").pop() ?? "" },
        { name: `${name}: no sideways scroll`, passed: sideways <= 0, detail: `${String(sideways)} px` },
        {
          // Only the directed photograph, in one size: no other format's photograph, no poster.
          name: `${name}: loads one photograph, the directed one`,
          passed: images.length === 1 && images.every((path) => path.includes(expected)),
          detail: images.map((path) => path.split("/").pop() ?? "").join(", ") || "none",
        },
      ];
      const readings = await legibilityOverTime(page);
      const measured = await page.evaluate(() => window.measure());
      checks.push(...[...renderChecks(measured, tokens), ...stageChecks(readings, tokens, stageTexts(measured))].map((c) => ({ ...c, name: `${name}: ${c.name}` })));
      await page.screenshot({ path: join(compareDir, `screen-${String(w)}x${String(h)}.png`) });
      await page.close();
      // The same screen at the device's real pixel density picks a sharper source, or the sharpest there is.
      const dense = await openWeb(browser, served.url, w, h, { dpr: w < 1000 ? 3 : 2 });
      const source = await dense.evaluate(() => document.querySelector(".scene image")?.getAttribute("href") ?? "");
      const widest = await dense.evaluate(() => {
        const srcsets = Object.values((JSON.parse(document.getElementById("scene-data")?.textContent ?? "{}") as WebScene).art).map((a) => a.srcset);
        return srcsets.map((s) => s.split(",").map((c) => Number(/(\d+)w/.exec(c)?.[1] ?? 0)));
      });
      await dense.close();
      const [at1, atDense] = [chosenWidth(href), chosenWidth(source)];
      const sharpest = Math.max(...(widest.find((ws) => ws.includes(atDense)) ?? [NaN]));
      checks.push({
        name: `${name}: sharper source at device density`,
        passed: source.includes(expected) && (atDense > at1 || atDense === sharpest),
        detail: `${String(at1)} w at 1×, ${String(atDense)} w at ${w < 1000 ? "3" : "2"}×${atDense === sharpest ? " (the sharpest)" : ""}`,
      });
      log("screens", checks);
    }

    // 3. Motion, reduced motion and accessible text, on a phone.
    const reduced = await openWeb(browser, served.url, 390, 844, { reduced: true });
    const still390 = await reduced.evaluate(() => ({
      film: document.querySelector<HTMLElement>(".film")?.offsetHeight ?? 0,
      view: window.innerHeight,
      faded: window.measure().texts.filter((x) => x.opacity < 0.98).map((x) => x.name),
      steep: document.querySelector(".steep")?.textContent ?? "",
    }));
    await reduced.close();
    log("motion", [
      { name: "reduced motion: no scroll length", passed: still390.film === still390.view, detail: `section ${String(still390.film)} px, screen ${String(still390.view)} px` },
      { name: "reduced motion: end state, every text shown", passed: still390.faded.length === 0 && still390.steep === steepText, detail: still390.faded.length === 0 ? `steep reads ${still390.steep}` : `still fading: ${still390.faded.join(", ")}` },
    ]);

    const moving = await openWeb(browser, served.url, 390, 844);
    // The opening plays by itself: by 1.2 s the headline has risen into place with no scroll.
    await moving.waitForTimeout(1200);
    const risen = await moving.evaluate(() => [...document.querySelectorAll<HTMLElement>(".headline .line")].map((line) => new DOMMatrix(getComputedStyle(line).transform).m42 / line.offsetHeight));
    const pxPerSecond = await moving.evaluate(() => (JSON.parse(document.getElementById("scene-data")?.textContent ?? "{}") as WebScene).pxPerSecond);
    const scrollLength = await moving.evaluate(() => (document.querySelector<HTMLElement>(".film")?.offsetHeight ?? 0) - window.innerHeight);
    await moving.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
    await moving.waitForTimeout(300);
    const atEnd = await moving.evaluate(() => window.measure().texts.filter((x) => x.opacity < 0.98).map((x) => x.name));
    await moving.close();
    log("motion", [
      { name: "opening: headline in place by 1.2 s without scrolling", passed: risen.length === copy.headline.length && risen.every((r) => r < 0.05), detail: risen.map((r) => `${(r * 100).toFixed(1)} % below`).join(", ") },
      {
        // The pace is the project's rule: 150 to 340 px per second of film, the same on every screen.
        name: "scroll: fixed pace, within the calm range",
        passed: pxPerSecond >= 150 && pxPerSecond <= 340 && scrollLength === Math.round(lengthS * pxPerSecond),
        detail: `${String(pxPerSecond)} px per second, ${String(scrollLength)} px of scroll for the film`,
      },
      { name: "scroll: end of the section shows the end state", passed: atEnd.length === 0, detail: atEnd.length === 0 ? "every text shown" : `still fading: ${atEnd.join(", ")}` },
    ]);

    const timed = await openWeb(browser, `${served.url}?drive=time`, 390, 844);
    const length = lengthS;
    await timed.waitForTimeout((length + 0.8) * 1000);
    const timedEnd = await timed.evaluate(() => ({ film: document.querySelector<HTMLElement>(".film")?.offsetHeight ?? 0, view: window.innerHeight, faded: window.measure().texts.filter((x) => x.opacity < 0.98).length }));
    await timed.close();
    // 4. Real use on a phone: scrolling back, the keyboard and focus.
    const using = await openWeb(browser, served.url, 390, 844);
    await using.waitForTimeout(INTRO_WAIT_MS);
    const frames2 = (): Promise<unknown> => using.evaluate(() => new Promise((done) => { requestAnimationFrame(() => { requestAnimationFrame(done); }); }));
    const scrollToFilm = async (t: number): Promise<void> => {
      await using.evaluate((s) => {
        const film = document.querySelector<HTMLElement>(".film");
        if (film === null) throw new Error("no film");
        window.scrollTo(0, (s / window.LANGD) * (film.offsetHeight - window.innerHeight));
      }, t);
      await frames2();
    };
    const shown = (): Promise<string[]> => using.evaluate(() => window.measure().texts.filter((x) => x.opacity >= 0.98).map((x) => x.name));
    await scrollToFilm(MID_FILM_S);
    const forward = await using.screenshot({ type: "png", animations: "disabled" });
    await scrollToFilm(lengthS);
    await scrollToFilm(MID_FILM_S);
    const backward = await using.screenshot({ type: "png", animations: "disabled" });
    const backDiff = await using.evaluate(comparePixels, { a: dataUrl(forward), b: dataUrl(backward) });
    await scrollToFilm(0);
    const atTop = await shown();
    // The keyboard scrolls the page like any other: End reaches the end state, Home the opening.
    await using.locator("body").focus();
    await using.keyboard.press("End");
    await using.waitForTimeout(400);
    const afterEnd = await using.evaluate(() => window.measure().texts.filter((x) => x.opacity < 0.98).map((x) => x.name));
    await using.keyboard.press("Home");
    await using.waitForTimeout(400);
    await using.keyboard.press("PageDown");
    await using.waitForTimeout(400);
    const afterPageDown = await using.evaluate(() => window.scrollY);
    await using.keyboard.press("Tab");
    const focus = await using.evaluate(() => {
      const stops = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")];
      const active = document.activeElement;
      const box = active?.getBoundingClientRect();
      return {
        stops: stops.length,
        active: active?.tagName ?? "none",
        visible: active === document.body || (box !== undefined && box.width > 0 && box.height > 0),
      };
    });
    await using.close();
    log("use", [
      { name: "scroll back: the same frame as scrolling forward", passed: backDiff.mean < 0.5 && backDiff.visible < 0.001, detail: describe(`forward vs back at ${String(MID_FILM_S)} s`, backDiff) },
      { name: "scroll back to the top: the opening, headline shown", passed: atTop.includes("headline"), detail: `shown: ${atTop.join(", ")}` },
      { name: "keyboard: End reaches the end state", passed: afterEnd.length === 0, detail: afterEnd.length === 0 ? "every text shown" : `still fading: ${afterEnd.join(", ")}` },
      { name: "keyboard: Page Down moves the film", passed: afterPageDown > 0, detail: `scrolled ${String(Math.round(afterPageDown))} px` },
      { name: "keyboard: no hidden focus stops", passed: focus.visible, detail: `${String(focus.stops)} focusable elements; Tab lands on ${focus.active}` },
    ]);

    log("motion", [{ name: "time mode: plays to the end in place", passed: timedEnd.faded === 0 && timedEnd.film === timedEnd.view, detail: `${String(timedEnd.faded)} texts still fading after ${String(length + 0.8)} s` }]);

    const a11y = await openWeb(browser, served.url, 390, 844, { reduced: true });
    const facts = await a11y.evaluate(() => ({
      lang: document.documentElement.lang,
      h1: [...document.querySelectorAll("h1")].filter((h) => h.closest("[aria-hidden=true]") === null).map((h) => h.textContent),
      art: { role: document.querySelector(".scene svg")?.getAttribute("role"), label: document.querySelector(".scene svg")?.getAttribute("aria-label") },
      steep: [...document.querySelectorAll(".stage .steep")].map((s) => ({ text: s.textContent, hidden: s.closest("[aria-hidden=true]") !== null })),
      selectable: getComputedStyle(document.querySelector(".headline") ?? document.body).userSelect,
    }));
    const tree = await a11y.locator("main").ariaSnapshot();
    await a11y.close();
    const headline = copy.headline.join(" ");
    log("accessibility", [
      { name: "page language set", passed: facts.lang === (campaign.lang ?? "en"), detail: facts.lang },
      { name: "one h1, the headline as one sentence", passed: facts.h1.length === 1 && facts.h1[0] === headline, detail: JSON.stringify(facts.h1) },
      { name: "photograph has a text alternative", passed: facts.art.role === "img" && (facts.art.label ?? "").length > 20, detail: facts.art.label ?? "none" },
      { name: "steeping instruction read once, as text", passed: copy.steep === undefined ? facts.steep.length === 0 : facts.steep.length === 1 && facts.steep[0]?.hidden === false && facts.steep[0].text === steepText, detail: JSON.stringify(facts.steep) },
      { name: "text is real, selectable text", passed: facts.selectable !== "none", detail: `user-select ${facts.selectable}` },
    ]);
    await writeFile(join(compareDir, "accessibility-tree.yaml"), tree);
    console.log(tree);

    // 4. The technical section: there, readable on a small phone, true to the render, and the scrubber
    // draws the same scene at the moment asked for.
    if (campaign.explainer !== undefined) log("explainer", await explainerChecks(browser, served.url, lengthS));

    // 4b. When something fails, the visitor still gets the message.
    const headlineShown = (page: Page): Promise<string[]> => page.evaluate(() => [...document.querySelectorAll("h1")].filter((h) => h.closest("[aria-hidden=true]") === null).map((h) => h.textContent));
    const posterShown = (page: Page): Promise<boolean> => page.evaluate(async () => {
      const img = document.querySelector<HTMLImageElement>(".poster img");
      if (img === null) return false;
      await img.decode().catch(() => undefined);
      return img.naturalWidth > 0;
    });
    const noScript = await openWeb(browser, served.url, 390, 844, { script: false, ready: ".poster img" });
    const noScriptFacts = { h1: await headlineShown(noScript), poster: await posterShown(noScript), film: await noScript.evaluate(() => document.querySelector<HTMLElement>(".film")?.offsetHeight ?? 0) };
    await noScript.close();
    const noFonts = await openWeb(browser, served.url, 390, 844, { fail: [".woff2"] });
    const noFontsFacts = { h1: await headlineShown(noFonts), fonts: await noFonts.evaluate(() => window.measure().fontsLoaded.length) };
    await noFonts.close();
    const noImage = await openWeb(browser, served.url, 390, 844, { fail: [".webp"] });
    const noImageH1 = await headlineShown(noImage);
    await noImage.close();
    const noScene = await openWeb(browser, served.url, 390, 844, { fail: [sceneFile], ready: ".fallback .poster img" });
    const noSceneFacts = { h1: await headlineShown(noScene), poster: await posterShown(noScene) };
    await noScene.close();
    const resized = await openWeb(browser, served.url, 390, 844);
    await resized.setViewportSize({ width: 1440, height: 900 });
    await resized.waitForFunction((id) => document.querySelector(".scene image")?.getAttribute("href")?.includes(id) === true, directedFor(1440, 900), { timeout: 10_000 }).catch(() => undefined);
    const resizedFacts = await resized.evaluate(() => ({ scenes: document.querySelectorAll(".stage .scene").length, href: document.querySelector(".stage .scene image")?.getAttribute("href") ?? "" }));
    await resized.evaluate(() => { window.seek(window.LANGD); });
    const resizedLayout = await resized.evaluate(() => window.measure());
    await resized.close();
    // Rebuilt means laid out exactly as a page opened at that size, not merely re-pointed at a photograph.
    const fresh = await openWeb(browser, served.url, 1440, 900);
    await fresh.evaluate(() => { window.seek(window.LANGD); });
    const freshLayout = await fresh.evaluate(() => window.measure());
    await fresh.close();
    const relaid = layoutMatches("resize", freshLayout, resizedLayout);
    const one = (h1: readonly string[]): boolean => h1.length === 1 && h1[0] === headline;
    log("resilience", [
      { name: "no JavaScript: poster and the copy as text, no scroll length", passed: one(noScriptFacts.h1) && noScriptFacts.poster && noScriptFacts.film === 844, detail: `h1 ${JSON.stringify(noScriptFacts.h1)}, poster ${noScriptFacts.poster ? "shown" : "missing"}, section ${String(noScriptFacts.film)} px` },
      { name: "fonts fail: the scene still starts, in system faces", passed: one(noFontsFacts.h1) && noFontsFacts.fonts === 0, detail: `${String(noFontsFacts.fonts)} web fonts loaded` },
      { name: "photograph fails: the words are still on the stage", passed: one(noImageH1), detail: JSON.stringify(noImageH1) },
      { name: "scene module fails: poster and the copy as text", passed: one(noSceneFacts.h1) && noSceneFacts.poster, detail: `poster ${noSceneFacts.poster ? "shown" : "missing"}` },
      {
        name: "resize phone to laptop: one scene, laid out as if opened at that size",
        passed: resizedFacts.scenes === 1 && resizedFacts.href.includes(directedFor(1440, 900)) && relaid.passed,
        detail: `${String(resizedFacts.scenes)} scene, ${resizedFacts.href.split("/").pop() ?? ""}; ${relaid.detail}`,
      },
      { name: "no requests to other hosts", passed: foreign.length === 0, detail: foreign.length === 0 ? "none" : foreign.join(", ") },
    ]);
  } finally {
    await browser.close();
    await served.close();
  }

  const all = Object.values(report).flat();
  await writeFile(join(PROJECT, "out", campaign.id, "web-check.json"), JSON.stringify({ checks: report, pixels: diffs }, null, 2));
  console.log(`${String(all.filter((c) => c.passed).length)}/${String(all.length)} web checks passed`);
  if (all.some((c) => !c.passed)) process.exitCode = 1;
}

const args = process.argv.slice(2);
const variantAt = args.indexOf("--variant");
if (variantAt >= 0 && (args[variantAt + 1] ?? "--").startsWith("--")) throw new Error("--variant needs an id");
await main(
  args.find((a, i) => !a.startsWith("--") && (variantAt < 0 || i !== variantAt + 1)) ?? "design/campaign.json",
  variantAt >= 0 ? args[variantAt + 1] : undefined,
);
