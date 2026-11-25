/**
 * The reuse test: the winter-morning scene rendered from design/variation.json, where variants change
 * only data (headline, colour layer, composition, photograph). Slow, real Chromium: `npm run test:variation`.
 *
 * It imports the FLUX.2 example the pipeline generated and a reviewer approved, renders stills, and
 * asserts what reuse means here: the source checks pass, every variant renders, the variants differ,
 * and the unchanged variant is byte for byte the winter-morning still (when that render exists).
 * Contrast checks may fail for a new combination; the test reports them, since that is the gate working.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import { ENGINE, sha256 } from "../src/source.ts";

const exec = promisify(execFile);
const SIDECAR = "../../examples/aster-lane/results/aster-tea-banner-20261122T061057/export/aster-tea-banner-flux2-klein-4b-q8-s636537.json";

interface Report {
  readonly checks: Readonly<Record<string, readonly { readonly name: string; readonly passed: boolean; readonly detail: string }[]>>;
  readonly outputs: Readonly<Record<string, string>>;
}

void it("changes headline, layer, composition and photograph without touching the renderer", { timeout: 600_000 }, async () => {
  await exec("node", ["src/import-asset.ts", SIDECAR, "flux-leaf", "--use", "feed,landscape", "--for", "render", "--focus", "0.35,0.35"], { cwd: ENGINE });
  // Exit 1 means some technical check failed; the report says which, and the source gate is asserted below.
  await exec("node", ["src/render.ts", "design/variation.json", "--stills"], { cwd: ENGINE }).catch((error: unknown) => error);
  const report = JSON.parse(await readFile(join(ENGINE, "out/aster-variation-test/report.json"), "utf8")) as Report;

  assert.deepEqual(report.checks["source"]?.filter((c) => !c.passed), []);
  const stills = ["original", "clay-hold", "flux-night"].flatMap((v) => ["feed", "landscape"].map((f) => `${v}-${f}.png`));
  for (const still of stills) assert.ok(report.outputs[still], `${still} rendered`);
  assert.equal(new Set(stills.map((s) => report.outputs[s])).size, stills.length, "every variant looks different");

  const base = await readFile(join(ENGINE, "out/aster-winter-morning-sunburst/morning-feed.png")).catch(() => undefined);
  if (base !== undefined) assert.equal(report.outputs["original-feed.png"], sha256(base), "unchanged variant equals the original render");

  const failed = Object.entries(report.checks).flatMap(([group, checks]) => checks.filter((c) => !c.passed).map((c) => `${group}: ${c.name} (${c.detail})`));
  console.log(failed.length === 0 ? "every technical check passed" : `checks that refused a combination:\n  ${failed.join("\n  ")}`);
});
