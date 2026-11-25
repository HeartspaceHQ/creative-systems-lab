/**
 * Delivery renderer of CSL Studio.
 *
 *   CSL_PROJECT=<delivery folder> node src/studio-render.ts
 *
 * Reads `<folder>/source.json` ({ brand, design, asset, formats, extras, fonts }), writes the engine's design
 * source next to it (design/tokens.json, design/campaign.json, assets/<asset>.json) and renders it
 * through the ordinary renderer into `<folder>/out/studio/`: `design-<format>.png` for every size and,
 * for the first size, `.mp4` and `.gif` (extra mp4 or gif) and `.pdf` (extra pdf). With no extras only
 * the stills are rendered. The image itself is already at `assets/<asset>.png`; its hash is verified.
 *
 * Exit code 0: rendered and every check passed. 1: rendered, but a check failed (the report is in
 * `out/studio/report.json`). 2: nothing could be rendered; the reason is on stderr.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { main } from "./render.ts";
import { PROJECT, sha256 } from "./source.ts";
import { parseOptions, StudioError, studioSource } from "./studio-design.ts";

const CAMPAIGN = "design/campaign.json";

async function writeJson(rel: string, value: unknown): Promise<void> {
  const file = join(PROJECT, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readSourceJson(): Promise<Record<string, unknown>> {
  const text = await readFile(join(PROJECT, "source.json"), "utf8").catch(() => {
    throw new Error("source.json is missing from the delivery folder.");
  });
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("source.json is not an object.");
  return parsed as Record<string, unknown>;
}

/** The checks that failed in the last report, for the error message of a render that could not start. */
async function failedChecks(campaignId: string): Promise<string[]> {
  const report = await readFile(join(PROJECT, "out", campaignId, "report.json"), "utf8").catch(() => undefined);
  if (report === undefined) return [];
  const parsed = JSON.parse(report) as { checks?: Record<string, { name: string; passed: boolean; detail: string }[]> };
  return Object.values(parsed.checks ?? {}).flat().filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
}

async function run(): Promise<void> {
  if (process.env["CSL_PROJECT"] === undefined || process.env["CSL_PROJECT"] === "") {
    throw new Error("CSL_PROJECT must name the delivery folder.");
  }
  const input = await readSourceJson();
  const source = studioSource(input["brand"], input["design"], input["asset"], input, input["fonts"]);
  const bytes = await readFile(join(PROJECT, source.manifest.path)).catch(() => {
    throw new Error(`The image ${source.manifest.path} is not in the delivery folder.`);
  });
  if (sha256(bytes) !== source.manifest.sha256) throw new Error(`The image ${source.manifest.path} does not match the approved one (hash differs).`);

  await writeJson("design/tokens.json", source.tokens);
  await writeJson(CAMPAIGN, source.campaign);
  await writeJson(source.manifestPath, source.manifest);
  try {
    await main(CAMPAIGN, parseOptions(input).extras.length === 0);
  } catch (error) {
    const failed = await failedChecks(source.campaign.id);
    throw new Error([error instanceof Error ? error.message : String(error), ...failed].join("\n"), { cause: error });
  }
}

try {
  await run();
} catch (error) {
  // A refused design names each field, so the caller can show the reason where the person can fix it.
  const message = error instanceof StudioError
    ? Object.entries(error.fields).map(([field, text]) => `${field}: ${text}`).join("\n")
    : error instanceof Error ? error.message : String(error);
  console.error(`studio-render: ${message}`);
  process.exitCode = 2;
}
