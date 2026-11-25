/**
 * HTML for the exported page's technical section, and the escaping the whole page uses.
 * Pure string building, no file access: web-export.ts gathers the parts and writes the page.
 *
 * The technical section's prose comes from a data file (design/explainer.json); every fact in it,
 * from model and approval to output hashes and check counts, is read from the asset manifests and
 * the render report the page was exported from, so the page cannot claim what the render did not do.
 */
import type { AssetManifest, Hex, Layer, Tokens } from "./types.ts";

export const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The prose of the technical section. */
export interface Explainer {
  readonly heading: string;
  readonly intro: string;
  readonly sections: readonly {
    readonly id: string;
    readonly heading: string;
    readonly body: readonly string[];
    readonly facts?: "asset" | "layer" | "outputs" | "checks" | "perf";
    readonly demo?: boolean;
  }[];
}

/** The parts of the render report the page states as facts. */
export interface RenderFacts {
  readonly checks: Readonly<Record<string, readonly { readonly name: string; readonly passed: boolean; readonly detail?: string }[]>>;
  readonly outputs: Readonly<Record<string, string>>;
  readonly rhetoric?: { readonly criteria: readonly { readonly judgement: string }[] };
}

/** One page's medians in a web-perf measurement (web-perf.ts writes them to web-perf.json). */
interface PerfRow {
  readonly ready: number | null;
  readonly bytes: number;
  readonly cpuBusy: number;
  readonly heap: number;
  readonly lateFrames: number;
}

/** The parts of the last web-perf measurement the page states as facts. */
export interface PerfFacts {
  readonly measured: string;
  readonly host: string;
  readonly results: Readonly<Record<string, Readonly<Record<string, PerfRow>>>>;
}

export interface ExplainerInput {
  readonly explainer: Explainer;
  readonly assets: readonly AssetManifest[];
  readonly layer: Layer;
  readonly tokens: Tokens;
  readonly report: RenderFacts;
  readonly lengthS: number;
  /** The last web-perf measurement of this page, if one was made. */
  readonly perf?: PerfFacts;
}

const short = (hash: string): string => hash.slice(0, 12);

function list(rows: readonly (readonly [string, string])[]): string {
  return `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

function assetFacts(assets: readonly AssetManifest[]): string {
  return assets.map((a) => list([
    ["Model", escapeHtml(a.source.model)],
    ["Licence", escapeHtml(a.source.licence)],
    ["Run, candidate", `<code>${escapeHtml(a.source.run_id)}</code>, <code>${escapeHtml(a.source.candidate_id)}</code>`],
    ["Recipe hash", `<code>${short(a.source.recipe_hash)}…</code>`],
    ["Image hash", `<code>${short(a.sha256)}…</code>`],
    ["Approved by", escapeHtml(a.source.approved_by)],
    ["Approved for", escapeHtml((a.source.approved_for ?? []).join(", ") || "nothing")],
    ["Directed for", escapeHtml(a.use?.join(", ") ?? "any format")],
  ])).join("");
}

function layerFacts(layer: Layer, tokens: Tokens): string {
  const swatch = (role: keyof Layer): readonly [string, string] => {
    const name = layer[role];
    const hex: Hex | undefined = tokens.colour[name];
    return [role, `<span class="swatch" style="background:${escapeHtml(hex ?? "transparent")}"></span>${escapeHtml(name)} <code>${escapeHtml(hex ?? "?")}</code>`];
  };
  const faces = [...new Set(Object.values(tokens.type).map((t) => t.family))].join(", ");
  return list([...(["ground", "text", "accent", "light", "glow", "warmth"] as const).map(swatch), ["Type", escapeHtml(faces)]]);
}

function outputFacts(report: RenderFacts): string {
  const rows = Object.entries(report.outputs).map(([name, hash]) => [name, `<code>${short(hash)}…</code>`] as const);
  return list(rows);
}

function checkFacts(report: RenderFacts): string {
  const all = Object.values(report.checks).flat();
  const passed = all.filter((c) => c.passed).length;
  const repro = report.checks["reproducibility"] ?? [];
  const criteria = report.rhetoric?.criteria ?? [];
  return list([
    ["Technical checks", `${String(passed)} of ${String(all.length)} passed in the render this page was exported from`],
    ["Reproducibility", repro.map((c) => `${escapeHtml(c.name)}: ${c.passed ? "yes" : "no"}`).join("<br>") || "not run"],
    ["Design criteria", `${String(criteria.length)}, each ${escapeHtml(criteria[0]?.judgement ?? "pending human review")}`],
  ]);
}

const kB = (bytes: number): string => `${Math.round(bytes / 1000).toLocaleString("en")} kB`;
const seconds = (ms: number | null): string => (ms === null ? "not measured" : `${(ms / 1000).toFixed(1)} s`);

function perfFacts(perf: PerfFacts | undefined): string {
  const phone = perf?.results["phone"];
  const scene = phone?.["scene (web export)"];
  const mp4 = phone?.["MP4 page"];
  if (perf === undefined || scene === undefined || mp4 === undefined) return list([["Measured", "not for this export"]]);
  const later = scene.ready !== null && mp4.ready !== null ? `${seconds(scene.ready - mp4.ready)} after the MP4's first frame` : "not measured";
  return list([
    ["Measured", `${escapeHtml(perf.measured.slice(0, 10))}, ${escapeHtml(perf.host)}; phone screen, Slow 4G and a CPU slowed four times`],
    ["This page", `${kB(scene.bytes)}; scene drawn after ${seconds(scene.ready)}, its headline rising in over the next second; main thread ${String(Math.round(scene.cpuBusy * 100))} % busy while scrolling; ${(scene.heap / 1e6).toFixed(1)} MB JavaScript heap; ${String(scene.lateFrames)} late frames`],
    ["The same film as MP4", `${kB(mp4.bytes)}; first frame after ${seconds(mp4.ready)}`],
    ["Trade-off", `${String(Math.round((scene.bytes / mp4.bytes) * 100))} % of the MP4's bytes; scene drawn ${later}`],
  ]);
}

/** The flow from brief to every medium, as an ordered list: it is a sequence, so it reads as one. */
const FLOW = `<ol class="flow" aria-label="From brief to delivery">
<li><b>Brief</b> what the image must show, for whom</li>
<li><b>Generate</b> candidates from a pinned model and a hashed recipe</li>
<li><b>Evaluate</b> automatic scores, never a verdict</li>
<li><b>Approve</b> a person decides; the decision is chained and sealed</li>
<li><b>Compose</b> tokens, SVG, HTML and CSS around the approved image</li>
<li><b>seek(t)</b> one function of time</li>
<li><b>Deliver</b> web page, PNG, PDF, MP4, GIF</li>
</ol>`;

export function explainerHtml(input: ExplainerInput): string {
  const { explainer, report } = input;
  const facts = {
    asset: () => assetFacts(input.assets),
    layer: () => layerFacts(input.layer, input.tokens),
    outputs: () => outputFacts(report),
    checks: () => checkFacts(report),
    perf: () => perfFacts(input.perf),
  };
  const demo = `<figure class="demo">
<div class="demo-stage" aria-hidden="true" inert></div>
<figcaption><label for="demo-t">Moment of the film</label>
<input id="demo-t" type="range" min="0" max="${String(input.lengthS)}" step="0.1" value="${String(input.lengthS)}">
<output id="demo-readout" for="demo-t">t = ${input.lengthS.toFixed(1)} s</output></figcaption>
</figure>`;
  const sections = explainer.sections.map((s) => `<section id="${escapeHtml(s.id)}" aria-labelledby="${escapeHtml(s.id)}-h">
<h3 id="${escapeHtml(s.id)}-h">${escapeHtml(s.heading)}</h3>
${s.body.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
${s.demo === true ? demo : ""}
${s.facts === undefined ? "" : facts[s.facts]()}
</section>`).join("\n");
  return `<section class="explainer" aria-labelledby="explainer-h">
<h2 id="explainer-h">${escapeHtml(explainer.heading)}</h2>
<p class="lede">${escapeHtml(explainer.intro)}</p>
${FLOW}
${sections}
</section>`;
}
