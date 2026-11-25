/**
 * Web export: the campaign's scene as one self-contained web page.
 *
 *   node src/web-export.ts [design/campaign.json] [--variant id]
 *
 * Writes out/<campaign>/web/. The page runs the same scene module, design tokens, stylesheet, fonts
 * and art-directed photographs as the renderer, with the web runtime (src/web.ts) driving t. Modules
 * are shipped as the TypeScript sources with types stripped: no bundler, no framework. Photographs
 * are verified by hash, then encoded as WebP in three widths. The renderer's end-state stills become
 * the poster for visitors without JavaScript. Run the renderer first.
 */
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { basename, join } from "node:path";
import { SHAPES, shapeMedia, shapeOf, type Shape } from "./shape.ts";
import { brotli } from "./static-server.ts";
import { maxZoom } from "./cinema.ts";
import { approvalProblem, FFMPEG, loadSource, readJson, pickVariant, resolveVariant, ENGINE, PROJECT, located, run, sceneModule, sha256, sourceHash } from "./source.ts";
import type { AssetManifest, WebArt, WebScene } from "./types.ts";
import { escapeHtml, explainerHtml, type Explainer, type PerfFacts, type RenderFacts } from "./web-page.ts";

/** Scroll distance per second of film. Within 150 to 340 px, the pace that reads as calm, on every screen. */
const PX_PER_SECOND = 240;
/** The opening that plays by itself: by then the headline has landed. */
const INTRO_S = 1.6;
/** Source widths as fractions of the photograph's own width. */
const WIDTHS = [0.5, 0.75, 1];
const WEBP_QUALITY = "82";


/** Width and height from a PNG's header. */
function pngSize(bytes: Buffer): { w: number; h: number } {
  if (bytes.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

async function webp(input: string, output: string, width: number): Promise<void> {
  await run(FFMPEG, ["-loglevel", "error", "-y", "-i", input, "-vf", `scale=${String(width)}:-2:flags=lanczos`,
    "-c:v", "libwebp", "-quality", WEBP_QUALITY, "-compression_level", "6", "-map_metadata", "-1", output]);
}

/** Strip types from a module and every module it imports, rewriting .ts specifiers to .js. */
async function shipModules(entries: readonly string[], outDir: string): Promise<string[]> {
  const shipped: string[] = [];
  const queue = [...entries];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (shipped.includes(name)) continue;
    shipped.push(name);
    const js = stripTypeScriptTypes(await readFile(join(ENGINE, "src", `${name}.ts`), "utf8"));
    const rewritten = js.replace(/from "\.\/([\w-]+)\.ts"/g, (_, dep: string) => {
      queue.push(dep);
      return `from "./${dep}.js"`;
    });
    await writeFile(join(outDir, "src", `${name}.js`), rewritten);
  }
  return shipped;
}

interface RenderReport extends RenderFacts {
  readonly source_hash?: string;
}

/** The scene this export knows how to ship: its stylesheet and fonts are copied by name below. */
const WEB_SCENES: ReadonlySet<string> = new Set(["cinema"]);

async function main(campaignPath: string, variantId: string | undefined): Promise<void> {
  const loaded = await loadSource(campaignPath);
  const { tokens, campaign, assetFor } = loaded;
  // The id names the output folder that is emptied below: a plain name, never a path.
  if (!/^[\w-]+$/.test(campaign.id)) throw new Error(`campaign id must be letters, digits, - or _: ${campaign.id}`);
  const variant = pickVariant(campaign, variantId);
  const { layer, copy, lengthS, composition } = resolveVariant(tokens, campaign, variant);
  // The browser picks a photograph source wide enough for the closest framing the scene ever draws.
  const artZoom = Math.round(maxZoom(composition) * 100) / 100;
  const scene = await sceneModule(campaign.page);
  if (!WEB_SCENES.has(scene)) throw new Error(`web export ships the ${[...WEB_SCENES].join(", ")} scene; ${campaign.page} uses ${scene}`);
  // Built beside the last export and swapped in at the end, so a failed export leaves the last good one.
  const final = join(PROJECT, "out", campaign.id, "web");
  const out = `${final}.building`;
  await rm(out, { recursive: true, force: true });
  await Promise.all(["src", "fonts", "img"].map((d) => mkdir(join(out, d), { recursive: true })));

  // One format, and so one directed photograph, per shape of screen.
  const byShape = new Map<Shape, { formatName: string; asset: AssetManifest }>();
  for (const [formatName, format] of Object.entries(campaign.formats)) {
    const shape = shapeOf(format.width, format.height);
    const asset = assetFor(variant, format);
    const taken = byShape.get(shape);
    if (taken !== undefined && taken.asset.path !== asset.path) {
      throw new Error(`${taken.formatName} and ${formatName} are both ${shape} but directed for different photographs`);
    }
    byShape.set(shape, taken ?? { formatName, asset });
  }

  // Photographs: verified, then encoded once each, whichever shapes share them.
  const artByAsset = new Map<string, WebArt>();
  const preloads: string[] = [];
  for (const asset of new Set([...byShape.values()].map((v) => v.asset))) {
    const png = await readFile(join(PROJECT, asset.path));
    if (sha256(png) !== asset.sha256) throw new Error(`${asset.path} does not match its manifest hash`);
    // A web page is published work: only photographs approved for the web go on one.
    const refused = approvalProblem(asset, "web");
    if (refused !== undefined) throw new Error(refused);
    const { w, h } = pngSize(png);
    const stem = asset.source.candidate_id;
    // The id names files and sits in HTML attributes: a plain name only.
    if (!/^[\w.-]+$/.test(stem)) throw new Error(`candidate id must be letters, digits, ., - or _: ${stem}`);
    const sources: string[] = [];
    for (const width of WIDTHS.map((f) => Math.round((w * f) / 2) * 2)) {
      const file = `img/${stem}-${String(width)}.webp`;
      await webp(join(PROJECT, asset.path), join(out, file), width);
      sources.push(`${file} ${String(width)}w`);
    }
    const aspect = w / h;
    const art: WebArt = {
      aspect,
      focus: asset.focus,
      ...(asset.light === undefined ? {} : { light: asset.light }),
      srcset: sources.join(", "),
      sizes: `calc(${String(artZoom)} * max(100vw, ${(aspect * 100).toFixed(2)}svh))`,
      ...(asset.alt === undefined ? {} : { alt: asset.alt }),
    };
    artByAsset.set(asset.path, art);
    const shapes = new Set(SHAPES.filter((s) => byShape.get(s)?.asset.path === asset.path));
    preloads.push(`<link rel="preload" as="image" imagesrcset="${escapeHtml(art.srcset)}" imagesizes="${escapeHtml(art.sizes)}" media="${shapeMedia(shapes)}" fetchpriority="high">`);
  }
  const art = Object.fromEntries(SHAPES.map((shape) => {
    const entry = byShape.get(shape);
    if (entry === undefined) throw new Error(`the campaign has no format for ${shape} screens`);
    const directed = artByAsset.get(entry.asset.path);
    if (directed === undefined) throw new Error(`no web image for ${entry.asset.path}`);
    return [shape, directed];
  })) as Record<Shape, WebArt>;

  // Poster for visitors without JavaScript: the renderer's own end state, per shape. Only from a
  // render whose checks all passed, and only the very still that render reported.
  const report = JSON.parse(await readFile(join(PROJECT, "out", campaign.id, "report.json"), "utf8")) as RenderReport;
  const failed = Object.values(report.checks).flat().filter((c) => !c.passed).length;
  if (failed > 0) throw new Error(`the last render has ${String(failed)} failed checks; render again before exporting`);
  if (report.source_hash !== await sourceHash(campaignPath, loaded)) {
    throw new Error("the design source or scene code changed since the last render; render again before exporting");
  }
  const posters: string[] = [];
  for (const shape of SHAPES) {
    const entry = byShape.get(shape);
    if (entry === undefined) continue;
    const stillName = `${variant.id}-${entry.formatName}.png`;
    const still = join(PROJECT, "out", campaign.id, stillName);
    if (report.outputs[stillName] !== sha256(await readFile(still))) throw new Error(`${stillName} is not the still the last render reported`);
    const file = `img/poster-${shape}.webp`;
    await webp(still, join(out, file), Math.min(1080, pngSize(await readFile(still)).w));
    posters.push(`<source media="${shapeMedia(new Set([shape]))}" srcset="${file}">`);
  }

  // Code, styles and fonts: the renderer's own files.
  const explainer = campaign.explainer === undefined ? undefined : await readJson<Explainer>(campaign.explainer);
  // The last measurement of the page (web-perf.ts), stated with its date; absent until one is made.
  const perf = await readFile(join(PROJECT, "out", campaign.id, "web-perf.json"), "utf8").then((t) => JSON.parse(t) as PerfFacts, () => undefined);
  const modules = await shipModules(["web", scene, ...(explainer === undefined ? [] : ["demo"])], out);
  await copyFile(await located("cinema.css"), join(out, "cinema.css"));
  if (explainer !== undefined) await copyFile(await located("explainer.css"), join(out, "explainer.css"));
  const fonts = ["PlayfairDisplay-latin-var.woff2", "DMSans-latin-var.woff2", "OFL-PlayfairDisplay.txt", "OFL-DMSans.txt"];
  await Promise.all(fonts.map(async (f) => copyFile(await located(`fonts/${f}`), join(out, "fonts", f))));

  const data: WebScene = {
    scene: { lengthS, tokens, layer, copy, brand: campaign.brand, composition },
    art,
    pxPerSecond: PX_PER_SECOND,
    introS: INTRO_S,
  };
  const ground = tokens.colour[layer.ground] ?? "#000";
  const headline = copy.headline.join(" ");
  const travel = Math.round(lengthS * PX_PER_SECOND);
  const fallback = `<picture class="poster">${posters.join("")}<img src="img/poster-medium.webp" alt=""></picture>
<div class="visually-hidden"><h1>${escapeHtml(headline)}</h1><p>${escapeHtml(copy.body)}</p><p>${escapeHtml(copy.cta)}</p></div>`;
  const page = `<!doctype html>
<html lang="${escapeHtml(campaign.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(`${campaign.brand}: ${headline}`)}</title>
<meta name="description" content="${escapeHtml(copy.body)}">
<meta name="color-scheme" content="dark">
${fonts.filter((f) => f.endsWith(".woff2")).map((f) => `<link rel="preload" as="font" type="font/woff2" href="fonts/${f}" crossorigin>`).join("\n")}
${preloads.join("\n")}
${modules.map((m) => `<link rel="modulepreload" href="src/${m}.js">`).join("\n")}
<link rel="stylesheet" href="cinema.css">
${explainer === undefined ? "" : '<link rel="stylesheet" href="explainer.css">'}
<style>
  html { background: ${ground}; }
  :root { ${(["ground", "text", "quiet", "accent", "line"] as const).map((role) => `--${role}: ${tokens.colour[layer[role]] ?? "inherit"};`).join(" ")} }
  body { margin: 0; }
  /* The scroll length is in the page itself, so a reload mid-film returns to the same place. */
  .film { position: relative; height: calc(100svh + ${String(travel)}px); }
  .film[data-drive="time"] { height: 100svh; }
  @media (prefers-reduced-motion: reduce) { .film { height: 100svh; } }
  .stage { position: sticky; top: 0; height: 100svh; overflow: hidden; }
  .fallback { height: 100%; }
  .poster, .poster img { display: block; width: 100%; height: 100%; object-fit: cover; }
</style>
<noscript><style>.film { height: 100svh; }</style></noscript>
</head>
<body>
<main>
<section class="film" data-drive="scroll">
<div class="stage">
<noscript><div class="fallback">
${fallback}
</div></noscript>
<template id="fallback"><div class="fallback">
${fallback}
</div></template>
</div>
</section>
${explainer === undefined ? "" : explainerHtml({ explainer, assets: [...new Set([...byShape.values()].map((v) => v.asset))], layer, tokens, report, lengthS, ...(perf === undefined ? {} : { perf }) })}
</main>
<script type="application/json" id="scene-data">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>
<script type="module">
  // Imported on demand, so a module that fails to load still leaves the page able to show the poster.
  Promise.all([import("./src/web.js"), import("./src/${scene}.js")])
    .then(([web, scene]) => {
      ${explainer === undefined ? "" : 'import("./src/demo.js").then((demo) => { demo.startDemo(scene.build); }).catch((error) => { console.error(error); });'}
      return web.startWeb(scene.build);
    })
    .catch((error) => {
      const fallback = document.getElementById("fallback");
      document.querySelector(".film").style.height = "100svh";
      if (fallback instanceof HTMLTemplateElement) document.querySelector(".stage").append(fallback.content.cloneNode(true));
      performance.mark("scene-failed");
      console.error(error);
    });
</script>
</body>
</html>
`;
  await writeFile(join(out, "index.html"), page);

  // What a visitor downloads, raw and as a host would send it.
  const files = ["index.html", "cinema.css", ...modules.map((m) => `src/${m}.js`), ...fonts.filter((f) => f.endsWith(".woff2")).map((f) => `fonts/${f}`)];
  let raw = 0;
  let sent = 0;
  for (const f of files) {
    const bytes = await readFile(join(out, f));
    const compressed = f.endsWith(".woff2") ? bytes.length : brotli(bytes).length;
    raw += bytes.length;
    sent += compressed;
    console.log(`${f.padEnd(44)} ${(bytes.length / 1024).toFixed(1).padStart(7)} kB  ${(compressed / 1024).toFixed(1).padStart(7)} kB sent`);
  }
  console.log(`code, styles, fonts: ${(raw / 1024).toFixed(1)} kB, ${(sent / 1024).toFixed(1)} kB sent; images by screen in ${basename(final)}/img`);
  await rm(final, { recursive: true, force: true });
  await rename(out, final);
  console.log(`wrote ${final}`);
}

const args = process.argv.slice(2);
const variantAt = args.indexOf("--variant");
if (variantAt >= 0 && (args[variantAt + 1] ?? "--").startsWith("--")) throw new Error("--variant needs an id");
await main(args.find((a, i) => !a.startsWith("--") && (variantAt < 0 || i !== variantAt + 1)) ?? "design/campaign.json", variantAt >= 0 ? args[variantAt + 1] : undefined);
