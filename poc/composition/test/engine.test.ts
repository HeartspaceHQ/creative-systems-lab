/**
 * Unit tests for the engine's pure parts: what decides layout family, colour contrast, variant
 * resolution, the reference and approval gates, the handover from the pipeline, and the page's
 * technical section. Node only,
 * no browser: `node --test test/`.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { maxZoom, verticalScrim } from "../src/cinema.ts";
import { contrast, sourceChecks } from "../src/checks.ts";
import { manifestFor, type ImportOptions } from "../src/import-asset.ts";
import { shapeOf } from "../src/shape.ts";
import { explainerHtml } from "../src/web-page.ts";
import { approvalProblem, campaignProblems, pickVariant, resolveVariant, ENGINE } from "../src/source.ts";
import type { AssetManifest, Campaign, Tokens } from "../src/types.ts";

const tokens = JSON.parse(await readFile(join(ENGINE, "design/tokens.json"), "utf8")) as Tokens;
const campaign = JSON.parse(await readFile(join(ENGINE, "design/variation.json"), "utf8")) as Campaign;

const asset = (source: Partial<AssetManifest["source"]>): AssetManifest => ({
  path: "assets/x.png",
  sha256: "0".repeat(64),
  focus: { x: 0.5, y: 0.5 },
  source: { run_id: "r", candidate_id: "c", recipe_hash: "h", model: "m", licence: "l", approved_by: "a reviewer", approved_for: ["render"], ...source },
});

void describe("shapeOf", () => {
  void it("puts the boundaries where the media queries do", () => {
    assert.equal(shapeOf(1300, 1000), "wide");
    assert.equal(shapeOf(1299, 1000), "medium");
    assert.equal(shapeOf(1000, 1600), "tall");
    assert.equal(shapeOf(1000, 1599), "medium");
    assert.equal(shapeOf(1080, 1350), "medium");
  });
});

void describe("contrast", () => {
  void it("is 21:1 for black on white and 1:1 for a colour on itself", () => {
    assert.equal(contrast("#000000", "#ffffff"), 21);
    assert.equal(contrast("#c46a3c", "#c46a3c"), 1);
  });
  void it("passes the project's own tokens", () => {
    assert.deepEqual(sourceChecks(tokens).filter((c) => !c.passed), []);
  });
});

void describe("resolveVariant", () => {
  void it("merges the variant's copy, layer and composition over the campaign's", () => {
    const resolved = resolveVariant(tokens, campaign, pickVariant(campaign, "clay-hold"));
    assert.deepEqual(resolved.copy.headline, ["Hold the", "warmth."]);
    assert.equal(resolved.copy.cta, campaign.copy.cta);
    assert.equal(resolved.layer, tokens.layers["clay"]);
    assert.equal(resolved.composition.zoom, 1.1);
  });
  void it("picks the first variant when none is asked for, and refuses an unknown one", () => {
    assert.equal(pickVariant(campaign).id, "original");
    assert.throws(() => pickVariant(campaign, "nope"), /no variant nope/);
  });
});

void describe("campaignProblems", () => {
  void it("finds nothing wrong with the variation campaign", () => {
    assert.deepEqual(campaignProblems(tokens, campaign), []);
  });
  void it("names unknown layers, film and print references and composition out of range", () => {
    const broken: Campaign = {
      ...campaign,
      variants: [{ id: "a", layer: "neon", composition: { zoom: 3, night: -1 } }],
      motion: [["b", "feed"]],
      print: [["a", "poster"]],
    };
    assert.deepEqual(campaignProblems(tokens, broken), [
      "variant a: unknown layer neon",
      "variant a: composition.zoom 3 outside 0.5..2",
      "variant a: composition.night -1 outside 0..1",
      "motion: unknown variant b",
      "print: unknown format poster",
    ]);
  });
});

void describe("approvalProblem", () => {
  void it("allows only the uses a person approved", () => {
    assert.equal(approvalProblem(asset({}), "render"), undefined);
    assert.match(approvalProblem(asset({}), "web") ?? "", /not approved for web/);
    assert.match(approvalProblem(asset({ approved_by: " " }), "render") ?? "", /no recorded approval/);
    assert.match(approvalProblem(asset({ approved_for: [] }), "render") ?? "", /not approved for render/);
  });
});

void describe("maxZoom", () => {
  void it("is the closest framing the scene draws, scaled by the composition", () => {
    assert.equal(Math.round(maxZoom({}) * 100) / 100, 1.34);
    assert.ok(Math.abs(maxZoom({ zoom: 1.5 }) - 1.5 * maxZoom({})) < 1e-9);
  });
});

void describe("manifestFor", () => {
  const options: ImportOptions = { name: "leaf", use: ["feed"], approvedFor: ["render"], focus: { x: 0.4, y: 0.4 } };
  const sidecar = {
    file: "a.png",
    sha256: "f".repeat(64),
    manifest: {
      candidate_id: "cand",
      recipe_hash: "rh",
      recipe: { pin: { model_id: "org/model", revision: "0123456789abcdef", backend: "b" }, prompt: "A cup on a table. Flat vector style." },
    },
    decision: { verdict: "approve", reviewer: "demo-reviewer", note: "fine", decided_at: "2026-11-22T06:12:48Z" },
    model_licence: { name: "Apache-2.0", commercial_use: true },
  };
  void it("keeps the pipeline's provenance and the reviewer's decision", () => {
    const m = manifestFor(sidecar, "run-1", options);
    assert.equal(m.sha256, sidecar.sha256);
    assert.equal(m.source.model, "org/model@0123456789ab (b)");
    assert.equal(m.source.approved_by, "demo-reviewer, 2026-11-22: fine");
    assert.equal(m.alt, "A cup on a table.");
  });
  void it("refuses a rejected image and a licence without commercial use", () => {
    assert.throws(() => manifestFor({ ...sidecar, decision: { ...sidecar.decision, verdict: "reject" } }, "r", options), /not approved/);
    assert.throws(() => manifestFor({ ...sidecar, model_licence: { name: "NC", commercial_use: false } }, "r", options), /commercial/);
  });
});

void describe("explainerHtml", () => {
  const layer = Object.values(tokens.layers)[0];
  if (layer === undefined) throw new Error("tokens have no layer");
  const html = explainerHtml({
    explainer: {
      heading: "How <this> was made",
      intro: "Intro",
      sections: [
        { id: "generated", heading: "Model", body: ["Only the photograph."], facts: "asset" },
        { id: "trust", heading: "Checks", body: ["Measured."], facts: "checks", demo: true },
      ],
    },
    assets: [asset({ approved_by: "a reviewer, 2026-11-22: \"fine\"", approved_for: ["render", "web"] })],
    layer,
    tokens,
    report: {
      checks: { feed: [{ name: "fits", passed: true }, { name: "legible", passed: false }], reproducibility: [{ name: "same bytes twice", passed: true }] },
      outputs: { "feed.png": "abcdef0123456789abcdef" },
    },
    lengthS: 10,
  });

  void it("escapes prose and manifest text", () => {
    assert.match(html, /How &lt;this&gt; was made/);
    assert.match(html, /&quot;fine&quot;/);
    assert.doesNotMatch(html, /<this>/);
  });

  void it("states the render's own counts, failures included", () => {
    assert.match(html, /2 of 3 passed/);
    assert.match(html, /same bytes twice: yes/);
    assert.match(html, /render, web/);
  });

  void it("gives the scrubber a label, the film's length, and hides its copy from assistive tech", () => {
    assert.match(html, /<label for="demo-t">/);
    assert.match(html, /max="10"/);
    assert.match(html, /class="demo-stage" aria-hidden="true" inert/);
  });

  void it("states the measured trade-off against the MP4, and says so when nothing was measured", () => {
    const row = (ready: number, bytes: number) => ({ ready, bytes, cpuBusy: 0.09, heap: 1_500_000, lateFrames: 0 });
    const withPerf = (perf?: Parameters<typeof explainerHtml>[0]["perf"]): string => explainerHtml({
      explainer: { heading: "H", intro: "I", sections: [{ id: "cost", heading: "Cost", body: ["Measured."], facts: "perf" }] },
      assets: [], layer, tokens, report: { checks: {}, outputs: {} }, lengthS: 10, ...(perf === undefined ? {} : { perf }),
    });
    const measured = withPerf({ measured: "2026-11-22T17:32:28Z", host: "a slowed Mac", results: { phone: { "scene (web export)": row(2600, 265_000), "MP4 page": row(1400, 572_000) } } });
    assert.match(measured, /46 % of the MP4's bytes; scene drawn 1\.2 s after the MP4's first frame/);
    assert.match(measured, /scene drawn after 2\.6 s/);
    assert.match(withPerf(), /not for this export/);
  });
});

void describe("verticalScrim", () => {
  const offsets = (stops: readonly (readonly [number, string, number])[]): number[] => stops.map(([at]) => at);
  const ascending = (xs: readonly number[]): boolean => xs.every((x, i) => i === 0 || x > (xs[i - 1] ?? -1));

  void it("keeps the stops it always had when title and credits are far apart", () => {
    const stops = verticalScrim(false, 0.4, 0.9, "#000");
    assert.deepEqual(stops.map(([at, , o]) => [Math.round(at * 1000), o]), [[0, 0.94], [270, 0.9], [410, 0.86], [480, 0.58], [560, 0.12], [620, 0], [764, 0], [874, 0.76], [1000, 0.94]]);
  });

  void it("never orders stops backwards or opens a gap on a short screen", () => {
    // 352 x 440: the title block ends at 0,57 and the credits start at 0,88, so the curves overlap.
    const stops = verticalScrim(false, 0.57, 0.88, "#000");
    assert.ok(ascending(offsets(stops)), JSON.stringify(stops));
    assert.ok(stops.every(([, , o]) => o > 0.05), "the dark holds between title and credits");
  });
});
