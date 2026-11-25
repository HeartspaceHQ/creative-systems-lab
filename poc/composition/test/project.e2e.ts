/**
 * A project kept outside the engine, the way another application uses it: design and assets in their
 * own folder, CSL_PROJECT pointing there, the engine untouched. The import, the render and every
 * output land in the project; the engine's own pages, scene code and fonts are what draw it.
 * Real Chromium: `npm run test:project`.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, it } from "node:test";
import { promisify } from "node:util";
import { ENGINE } from "../src/source.ts";

const exec = promisify(execFile);
const SIDECAR = resolve(ENGINE, "../../examples/aster-lane/results/aster-tea-banner-20261122T061057/export/aster-tea-banner-flux2-klein-4b-q8-s636537.json");

interface Report {
  readonly checks: Readonly<Record<string, readonly { readonly name: string; readonly passed: boolean; readonly detail: string }[]>>;
  readonly outputs: Readonly<Record<string, string>>;
}

const project = await mkdtemp(join(tmpdir(), "csl-project-"));
after(() => rm(project, { recursive: true, force: true }));

void it("renders a project kept outside the engine into that project", { timeout: 300_000 }, async () => {
  await mkdir(join(project, "design"));
  await Promise.all(["tokens.json", "demo.json"].map((f) => copyFile(join(ENGINE, "design", f), join(project, "design", f))));
  const env = { ...process.env, CSL_PROJECT: project };
  const engineOut = join(ENGINE, "out/aster-demo/report.json");
  const before = await stat(engineOut).then((s) => s.mtimeMs, () => undefined);

  await exec("node", [join(ENGINE, "src/import-asset.ts"), SIDECAR, "flux-leaf", "--use", "feed,landscape", "--for", "render", "--focus", "0.35,0.35"], { cwd: project, env });
  await exec("node", [join(ENGINE, "src/render.ts"), "design/demo.json", "--stills"], { cwd: project, env }).catch((error: unknown) => error);

  const report = JSON.parse(await readFile(join(project, "out/aster-demo/report.json"), "utf8")) as Report;
  const failed = Object.entries(report.checks).flatMap(([group, checks]) => checks.filter((c) => !c.passed).map((c) => `${group}: ${c.name} (${c.detail})`));
  assert.deepEqual(failed, []);
  assert.ok((await stat(join(project, "out/aster-demo/flux-night-feed.png"))).size > 0, "the still is in the project");
  assert.ok((await stat(join(project, "assets/flux-leaf.json"))).size > 0, "the import wrote the project's manifest");
  assert.equal(await stat(engineOut).then((s) => s.mtimeMs, () => undefined), before, "the engine's own output is untouched");
});
