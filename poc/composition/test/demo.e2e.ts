/**
 * The fresh-clone chain, end to end and without keys: import the approved FLUX.2 klein image from the
 * committed pipeline export, render one still with every check, and require that every check passed,
 * including two renders from fresh pages giving the same bytes. Real Chromium: `npm run test:demo`.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { promisify } from "node:util";
import { ENGINE } from "../src/source.ts";

const exec = promisify(execFile);
const SIDECAR = "../../examples/aster-lane/results/aster-tea-banner-20261122T061057/export/aster-tea-banner-flux2-klein-4b-q8-s636537.json";

interface Report {
  readonly checks: Readonly<Record<string, readonly { readonly name: string; readonly passed: boolean; readonly detail: string }[]>>;
  readonly outputs: Readonly<Record<string, string>>;
}

void it("renders a still from a fresh clone with every check passing", { timeout: 300_000 }, async () => {
  await exec("node", ["src/import-asset.ts", SIDECAR, "flux-leaf", "--use", "feed,landscape", "--for", "render", "--focus", "0.35,0.35"], { cwd: ENGINE });
  // A failed check exits 1; the report below names it, so the assertion message is the useful one.
  await exec("node", ["src/render.ts", "design/demo.json", "--stills"], { cwd: ENGINE }).catch((error: unknown) => error);
  const report = JSON.parse(await readFile(join(ENGINE, "out/aster-demo/report.json"), "utf8")) as Report;

  const failed = Object.entries(report.checks).flatMap(([group, checks]) => checks.filter((c) => !c.passed).map((c) => `${group}: ${c.name} (${c.detail})`));
  assert.deepEqual(failed, []);
  assert.ok(report.outputs["flux-night-feed.png"], "the still was rendered");
  assert.ok((report.checks["reproducibility"] ?? []).length > 0, "reproducibility was checked");
});
