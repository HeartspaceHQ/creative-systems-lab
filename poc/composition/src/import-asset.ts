/**
 * The handover from generation to composition: an image the pipeline exported after human review
 * becomes an asset the composition engine may place.
 *
 *   node src/import-asset.ts <export sidecar .json> <asset name> --use feed,story --for render[,web]
 *        [--focus 0.5,0.5]
 *
 * The pipeline's export sidecar carries the image hash, the recipe, the model licence and the review
 * decision. This refuses anything the pipeline did not approve, any image whose bytes do not match
 * the sidecar, and any model whose licence forbids commercial use. It copies the image into assets/
 * and writes a manifest that keeps that provenance. Which uses the approval covers (render, web) and
 * where the subject sits (focus) are the designer's choices, so they are arguments, not guesses.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { PROJECT, sha256 } from "./source.ts";
import type { AssetManifest } from "./types.ts";

/** The fields of the pipeline's export sidecar (src/csl/export.py) this import reads. */
interface ExportSidecar {
  readonly file: string;
  readonly sha256: string;
  readonly manifest: {
    readonly candidate_id: string;
    readonly recipe_hash: string;
    readonly recipe: {
      readonly pin: { readonly model_id: string; readonly revision: string; readonly backend: string };
      readonly prompt: string;
    };
  };
  readonly decision: { readonly verdict: string; readonly reviewer: string; readonly note: string; readonly decided_at: string };
  readonly model_licence: { readonly name: string; readonly commercial_use: boolean };
}

type Use = "render" | "web";

export interface ImportOptions {
  readonly name: string;
  readonly use: readonly string[];
  readonly approvedFor: readonly Use[];
  readonly focus: { readonly x: number; readonly y: number };
}

/** Pure: the manifest for an approved export, or an error naming what is missing. */
export function manifestFor(sidecar: ExportSidecar, runId: string, options: ImportOptions): AssetManifest {
  if (sidecar.decision.verdict !== "approve") throw new Error(`${sidecar.file} was not approved in review (${sidecar.decision.verdict})`);
  if (!sidecar.model_licence.commercial_use) throw new Error(`${sidecar.model_licence.name} does not allow commercial use`);
  if (!/^[\w-]+$/.test(options.name)) throw new Error(`asset name must be letters, digits, - or _: ${options.name}`);
  const { pin } = sidecar.manifest.recipe;
  // The prompt's first sentence says what the image shows; the generator was asked for exactly that.
  const alt = sidecar.manifest.recipe.prompt.split(/(?<=\.)\s/)[0] ?? "";
  return {
    path: `assets/${options.name}.png`,
    sha256: sidecar.sha256,
    focus: options.focus,
    source: {
      run_id: runId,
      candidate_id: sidecar.manifest.candidate_id,
      recipe_hash: sidecar.manifest.recipe_hash,
      model: `${pin.model_id}@${pin.revision.slice(0, 12)} (${pin.backend})`,
      licence: sidecar.model_licence.name,
      approved_by: `${sidecar.decision.reviewer}, ${sidecar.decision.decided_at.slice(0, 10)}: ${sidecar.decision.note}`,
      approved_for: options.approvedFor,
    },
    use: options.use,
    ...(alt === "" ? {} : { alt }),
  };
}

function option(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

async function main(args: readonly string[]): Promise<void> {
  const [sidecarPath, name] = args;
  const use = option(args, "--use")?.split(",");
  const approvedFor = option(args, "--for")?.split(",");
  if (sidecarPath === undefined || name === undefined || use === undefined || approvedFor === undefined) {
    throw new Error("usage: import-asset.ts <sidecar.json> <name> --use feed,story --for render[,web] [--focus x,y]");
  }
  if (!approvedFor.every((u): u is Use => u === "render" || u === "web")) throw new Error("--for takes render and/or web");
  const [fx = 0.5, fy = 0.5] = (option(args, "--focus") ?? "0.5,0.5").split(",").map(Number);
  const sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as ExportSidecar;
  const image = join(dirname(sidecarPath), sidecar.file);
  if (sha256(await readFile(image)) !== sidecar.sha256) throw new Error(`${image} does not match its sidecar hash`);
  // The run is the folder above export/: results/<run id>/export/<file>.json
  const runId = basename(dirname(dirname(sidecarPath)));
  const manifest = manifestFor(sidecar, runId, { name, use, approvedFor, focus: { x: fx, y: fy } });
  await mkdir(join(PROJECT, "assets"), { recursive: true });
  await copyFile(image, join(PROJECT, manifest.path));
  await writeFile(join(PROJECT, "assets", `${name}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`assets/${name}.json  ${manifest.source.candidate_id}, approved by ${manifest.source.approved_by}`);
}

if (import.meta.main) await main(process.argv.slice(2));
