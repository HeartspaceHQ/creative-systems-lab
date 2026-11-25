/**
 * What the studio's `/engine/*` serves, written to a folder:
 *
 *   node src/studio-assets.ts <outdir>
 *
 * The preview page (studio.html), the stylesheets it links, the bundled fonts and every module the
 * preview imports, with TypeScript types stripped and the `.ts` names kept, as the renderer serves
 * them. The server sends `.ts` files as JavaScript. Node only.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { ENGINE, moduleGraph } from "./source.ts";

const PAGE = "studio.html";
const ENTRY = "studio-preview";

/** Write the preview's files to `outdir`; returns the paths written, relative to it. */
export async function writeStudioAssets(outdir: string): Promise<string[]> {
  const root = resolve(outdir);
  const written: string[] = [];
  const put = async (rel: string, body: string | Buffer): Promise<void> => {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), body);
    written.push(rel);
  };

  const page = await readFile(join(ENGINE, PAGE), "utf8");
  await put(PAGE, page);
  for (const match of page.matchAll(/<link rel="stylesheet" href="([\w.-]+)"/g)) {
    const css = match[1];
    if (css !== undefined) await put(css, await readFile(join(ENGINE, css), "utf8"));
  }
  for (const font of (await readdir(join(ENGINE, "fonts"))).filter((f) => f.endsWith(".woff2"))) {
    await put(`fonts/${font}`, await readFile(join(ENGINE, "fonts", font)));
  }
  for (const module of await moduleGraph([ENTRY])) {
    const rel = `src/${module}.ts`;
    await put(rel, stripTypeScriptTypes(await readFile(join(ENGINE, rel), "utf8")));
  }
  return written;
}

if (import.meta.main) {
  const outdir = process.argv[2];
  if (outdir === undefined) {
    console.error("usage: node src/studio-assets.ts <outdir>");
    process.exitCode = 2;
  } else {
    for (const file of await writeStudioAssets(outdir)) console.log(file);
  }
}
