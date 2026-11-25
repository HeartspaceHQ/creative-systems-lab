/**
 * The design source on disk and how it reaches a browser: shared by the renderer and the web export.
 * Node only.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssetManifest, Campaign, Format, Tokens, Variant } from "./types.ts";

export { resolveVariant, sceneData } from "./resolve.ts";
export type { Resolved } from "./resolve.ts";

/** The engine: scene code, pages, stylesheets and the bundled fonts. */
export const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The project: `design/`, `assets/` and `out/`, plus any page, stylesheet or font that overrides the
 * engine's. Set CSL_PROJECT to work on a project kept outside this package; unset, the engine's own
 * Aster Lane examples are the project.
 */
export const PROJECT = resolve(process.env["CSL_PROJECT"] ?? ENGINE);
/** Folders only a project has. Nothing in them is ever read from the engine. */
const PROJECT_ONLY = ["design/", "assets/", "out/"];

/** `rel` inside `root`, or undefined if it would leave it. */
function inside(root: string, rel: string): string | undefined {
  const file = resolve(root, rel);
  return file.startsWith(root + sep) ? file : undefined;
}

/**
 * Where a project-relative path is read from. Scene code comes only from the engine, design and
 * assets only from the project; a page, stylesheet or font is the project's own if it has one.
 */
export async function locate(rel: string): Promise<string | undefined> {
  if (rel.startsWith("src/")) return inside(ENGINE, rel);
  const own = inside(PROJECT, rel);
  if (PROJECT_ONLY.some((dir) => rel.startsWith(dir)) || own === undefined) return own;
  const found = await access(own).then(() => true, () => false);
  return found ? own : inside(ENGINE, rel);
}

/** `locate`, where a path outside both roots is an error. */
export async function located(rel: string): Promise<string> {
  const file = await locate(rel);
  if (file === undefined) throw new Error(`${rel} is outside the project and the engine`);
  return file;
}

export async function readSource(rel: string): Promise<Buffer> {
  return readFile(await located(rel));
}
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".ts": "text/javascript",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".css": "text/css",
  ".webp": "image/webp",
  ".json": "application/json",
};
/** External tools, found on PATH unless set: FFMPEG=/path/to/ffmpeg, PDFFONTS=/path/to/pdffonts. */
export const FFMPEG = process.env["FFMPEG"] ?? "ffmpeg";
export const PDFFONTS = process.env["PDFFONTS"] ?? "pdffonts";

export const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse((await readSource(path)).toString("utf8")) as T;
}

export function run(cmd: string, args: readonly string[], input?: AsyncIterable<Uint8Array>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${String(code)}: ${err.slice(-600)}`));
    });
    if (input === undefined) {
      child.stdin.end();
      return;
    }
    // If the process exits early its stdin closes: the write error is expected, and the exit code
    // (reported on close) says what went wrong. If the frames fail, the process is stopped.
    child.stdin.on("error", () => undefined);
    const exited = new Promise<void>((done) => child.once("close", () => { done(); }));
    (async () => {
      for await (const chunk of input) {
        if (child.stdin.destroyed) return;
        if (!child.stdin.write(chunk)) await Promise.race([new Promise((r) => child.stdin.once("drain", r)), exited]);
      }
      child.stdin.end();
    })().catch((error: unknown) => {
      child.kill();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/** The variant a tool was asked for, else the campaign's first. */
export function pickVariant(campaign: Campaign, id?: string): Variant {
  const variant = id === undefined ? campaign.variants[0] : campaign.variants.find((v) => v.id === id);
  if (variant === undefined) throw new Error(`no variant ${id ?? "(first)"} in ${campaign.id}`);
  return variant;
}

/**
 * Everything wrong with a campaign's references before anything renders: unknown layers, formats
 * or variants in the film and print lists, composition values out of range. An empty list is clean.
 */
export function campaignProblems(tokens: Tokens, campaign: Campaign): string[] {
  const problems: string[] = [];
  const variants = new Set(campaign.variants.map((v) => v.id));
  if (variants.size !== campaign.variants.length) problems.push("variant ids are not unique");
  if (campaign.variants.length === 0) problems.push("no variants");
  for (const v of campaign.variants) {
    if (tokens.layers[v.layer] === undefined) problems.push(`variant ${v.id}: unknown layer ${v.layer}`);
    for (const [key, value] of Object.entries({ ...campaign.composition, ...v.composition })) {
      if (typeof value === "string") {
        if (key !== "framing" || !["close", "whole"].includes(value)) problems.push(`variant ${v.id}: composition.${key} ${value} is not close or whole`);
        continue;
      }
      const [lo, hi] = key === "night" ? [0, 1] : [0.5, 2];
      if (!(value >= lo && value <= hi)) problems.push(`variant ${v.id}: composition.${key} ${String(value)} outside ${String(lo)}..${String(hi)}`);
    }
  }
  for (const [list, pairs] of [["motion", campaign.motion], ["print", campaign.print]] as const) {
    for (const [variant, format] of pairs) {
      if (!variants.has(variant)) problems.push(`${list}: unknown variant ${variant}`);
      if (campaign.formats[format] === undefined) problems.push(`${list}: unknown format ${format}`);
    }
  }
  return problems;
}

/**
 * Why an asset may not be used for a purpose, or undefined if it may. Approval is a human decision
 * recorded in the manifest: who approved it, and for which uses. Render and web export share this rule.
 */
export function approvalProblem(asset: AssetManifest, use: "render" | "web"): string | undefined {
  if (asset.source.approved_by.trim() === "") return `${asset.path} has no recorded approval`;
  if (asset.source.approved_for?.includes(use) !== true) return `${asset.path} is not approved for ${use}: ${asset.source.approved_by}`;
  return undefined;
}

/** Serve a project or engine file to the page; `.ts` modules go out as plain JavaScript. */
export async function serve(url: string): Promise<{ body: Buffer | string; contentType: string } | undefined> {
  const file = await locate(decodeURIComponent(new URL(url).pathname.slice(1)));
  const contentType = file === undefined ? undefined : CONTENT_TYPES[extname(file)];
  if (file === undefined || contentType === undefined) return undefined;
  // A missing file is the page's 404, reported by the scene, not a crash of the renderer.
  const bytes = await readFile(file).catch(() => undefined);
  if (bytes === undefined) return undefined;
  return { body: extname(file) === ".ts" ? stripTypeScriptTypes(bytes.toString("utf8")) : bytes, contentType };
}

/** A campaign with its tokens and every asset manifest it names, loaded once. */
export interface Source {
  readonly tokens: Tokens;
  readonly campaign: Campaign;
  readonly assets: ReadonlyMap<string, AssetManifest>;
  /** The photograph for a variant in a format: the variant's own, else the format's, else the campaign's. */
  readonly assetFor: (variant: Variant, format: Format) => AssetManifest;
}

/** The scene module a campaign page starts: the one it imports `build` from. */
export async function sceneModule(page: string): Promise<string> {
  const htmlText = (await readSource(page)).toString("utf8");
  const match = /import \{ build \} from "\.\/src\/([\w-]+)\.ts"/.exec(htmlText);
  if (match?.[1] === undefined) throw new Error(`${page} does not import a scene's build`);
  return match[1];
}

/** A module and every module it imports, by name, from src/. */
export async function moduleGraph(entries: readonly string[]): Promise<string[]> {
  const seen: string[] = [];
  const queue = [...entries];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (seen.includes(name)) continue;
    seen.push(name);
    const text = await readFile(join(ENGINE, "src", `${name}.ts`), "utf8");
    for (const m of text.matchAll(/from "\.\/([\w-]+)\.ts"/g)) if (m[1] !== undefined) queue.push(m[1]);
  }
  return seen;
}

/**
 * One hash over everything that decides what the renderer draws: tokens, campaign, asset manifests,
 * the page, its stylesheets and its scene code. A poster is only current if its render had this hash.
 */
export async function sourceHash(campaignPath: string, source: Source): Promise<string> {
  const pageText = (await readSource(source.campaign.page)).toString("utf8");
  const styles = [...pageText.matchAll(/<link rel="stylesheet" href="([\w.-]+)">/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
  const modules = await moduleGraph([await sceneModule(source.campaign.page)]);
  const files = [
    "design/tokens.json", campaignPath, ...source.assets.keys(),
    source.campaign.page, ...styles, ...modules.map((m) => `src/${m}.ts`),
  ];
  const parts = await Promise.all(files.map(async (f) => `${f}:${sha256(await readSource(f))}`));
  return sha256(parts.join("\n"));
}

export async function loadSource(campaignPath: string): Promise<Source> {
  const tokens = await readJson<Tokens>("design/tokens.json");
  const campaign = await readJson<Campaign>(campaignPath);
  const assetPaths = [...new Set([
    campaign.asset,
    ...Object.values(campaign.formats).flatMap((f) => (f.asset === undefined ? [] : [f.asset])),
    ...campaign.variants.flatMap((v) => (v.asset === undefined ? [] : [v.asset])),
  ])];
  const assets = new Map(await Promise.all(assetPaths.map(async (p) => [p, await readJson<AssetManifest>(p)] as const)));
  const assetFor = (variant: Variant, format: Format): AssetManifest => {
    const path = variant.asset ?? format.asset ?? campaign.asset;
    const manifest = assets.get(path);
    if (manifest === undefined) throw new Error(`asset manifest not loaded: ${path}`);
    return manifest;
  };
  return { tokens, campaign, assets, assetFor };
}
