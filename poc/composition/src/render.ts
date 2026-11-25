/**
 * Deterministic renderer: one design source, many outputs.
 *
 *   node src/render.ts [design/campaign.json]   all variants × formats, motion, PDF, checks
 *
 * Source checks run first and stop the render on failure. The image asset is verified by hash and is
 * never regenerated here; changing copy, colour layer or format only re-runs this script.
 *
 * The page is served to the browser from this folder under a placeholder origin, with TypeScript
 * types stripped on the way. Every other request is aborted, so a render never touches the network.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { renderChecks, sourceChecks, stageChecks, type Check } from "./checks.ts";
import { frame, legibilityOverTime, openScene, pixels, stageTexts, still, warmth } from "./inspect.ts";
import { approvalProblem, campaignProblems, FFMPEG, loadSource, PDFFONTS, PROJECT, run, sceneData, sha256, sourceHash } from "./source.ts";
import type { Criterion, Format, Measurement, Rhetoric, SceneData, Variant } from "./types.ts";

interface Job {
  readonly variant: Variant;
  readonly formatName: string;
  readonly format: Format;
  readonly data: SceneData;
}

async function measureCriterion(page: Page, criterion: Criterion, format: string): Promise<Check | undefined> {
  const measure = criterion.measure;
  if (measure === undefined) return undefined;
  const at = async (t: number): Promise<number> => warmth(await pixels(page, await still(page, t), []));
  const before = await at(measure.from_s);
  const after = await at(measure.to_s);
  return {
    name: `warmth rises ${format}`,
    passed: after > before + 4 && after > 0,
    detail: `red minus blue ${before.toFixed(1)} at ${String(measure.from_s)} s, ${after.toFixed(1)} at ${String(measure.to_s)} s; must rise and end above 0`,
  };
}

interface CriterionReport {
  readonly id: string;
  readonly appeal: Criterion["appeal"];
  readonly criterion: string;
  readonly evidence: readonly { readonly check: string; readonly passed: boolean }[];
  readonly judgement: string;
}

/** Tie each criterion to the technical checks that support it. Support is not proof: the judgement stays human. */
function rhetoricReport(rhetoric: Rhetoric, checks: readonly Check[]): { situation: Rhetoric["situation"]; criteria: CriterionReport[] } {
  return {
    situation: rhetoric.situation,
    criteria: rhetoric.criteria.map((c) => ({
      id: c.id,
      appeal: c.appeal,
      criterion: c.criterion,
      evidence: checks.filter((check) => c.evidence.some((e) => check.name.includes(e))).map((check) => ({ check: check.name, passed: check.passed })),
      judgement: "pending human review",
    })),
  };
}

async function* frames(page: Page, length: number, fps: number): AsyncGenerator<Uint8Array> {
  const cdp = await page.context().newCDPSession(page);
  const count = Math.round(length * fps);
  for (let i = 0; i <= count; i++) yield await frame(page, cdp, i / fps);
  await cdp.detach();
}

export async function main(campaignPath: string, stillsOnly: boolean): Promise<void> {
  const started = Date.now();
  const loaded = await loadSource(campaignPath);
  const { tokens, campaign, assets, assetFor } = loaded;
  const timings: Record<string, number> = {};
  let lapStarted = Date.now();
  const lap = (label: string): void => {
    timings[label] = (timings[label] ?? 0) + (Date.now() - lapStarted) / 1000;
    lapStarted = Date.now();
  };
  const OUT = join(PROJECT, "out", campaign.id);

  const report: {
    checks: Record<string, Check[]>;
    outputs: Record<string, string>;
    assets: Record<string, string>;
    timings_s: Record<string, number>;
    notes: string[];
    /** What this render was drawn from; the web export refuses posters from any other source. */
    source_hash: string;
    rhetoric?: ReturnType<typeof rhetoricReport>;
  } = { checks: {}, outputs: {}, assets: {}, timings_s: timings, notes: [], source_hash: await sourceHash(campaignPath, loaded) };

  // Tier 1: the design source. Nothing renders if this fails.
  const source = sourceChecks(tokens);
  const problems = campaignProblems(tokens, campaign);
  source.push({ name: "campaign references resolve", passed: problems.length === 0, detail: problems.join("; ") || "variants, layers, formats, film and print lists" });
  for (const asset of assets.values()) {
    // A photograph that is not on disk (generated images are git-ignored) fails the check, not the process.
    const bytes = await readFile(join(PROJECT, asset.path)).catch(() => undefined);
    const assetHash = bytes === undefined ? undefined : sha256(bytes);
    source.push({
      name: "asset hash matches manifest",
      passed: assetHash === asset.sha256,
      detail: assetHash === undefined
        ? `${asset.path} is missing; generated photographs are not in Git (see README)`
        : `${assetHash.slice(0, 16)} from ${asset.source.run_id}/${asset.source.candidate_id}`,
    });
    const refused = approvalProblem(asset, "render");
    source.push({ name: "asset approved for render", passed: refused === undefined, detail: refused ?? asset.source.approved_by });
  }
  for (const variant of campaign.variants) {
    for (const [formatName, format] of Object.entries(campaign.formats)) {
      const asset = assetFor(variant, format);
      source.push({
        name: `asset directed for ${formatName}`,
        passed: asset.use === undefined || asset.use.includes(formatName),
        detail: `${variant.id}: ${asset.source.candidate_id} is for ${asset.use?.join(", ") ?? "any format"}`,
      });
    }
  }
  report.checks["source"] = source;
  for (const c of source) console.log(`${c.passed ? "ok  " : "FAIL"} ${c.name}  ${c.detail}`);
  if (source.some((c) => !c.passed)) {
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, "report.json"), JSON.stringify(report, null, 2));
    throw new Error("source checks failed; fix the design source before rendering");
  }

  await mkdir(OUT, { recursive: true });

  const jobs: Job[] = campaign.variants.flatMap((variant) =>
    Object.entries(campaign.formats).map(([formatName, format]) => ({
      variant,
      formatName,
      format,
      data: sceneData(tokens, campaign, assetFor(variant, format), variant, format),
    })),
  );

  const browser = await chromium.launch();
  try {
    for (const job of jobs) {
      const name = `${job.variant.id}-${job.formatName}`;
      const asset = assetFor(job.variant, job.format);
      report.assets[name] = `${asset.source.candidate_id} (${asset.source.model}), approval: ${asset.source.approved_by}`;
      const page = await openScene(browser, campaign.page, job.data);
      const png = await still(page);
      const measured = await page.evaluate(() => window.measure());
      const checks = renderChecks(measured satisfies Measurement, tokens);
      checks.push(...stageChecks(await legibilityOverTime(page), tokens, stageTexts(measured)));
      for (const criterion of campaign.rhetoric?.criteria ?? []) {
        const check = await measureCriterion(page, criterion, job.formatName);
        if (check !== undefined) checks.push(check);
      }
      await page.close();
      await writeFile(join(OUT, `${name}.png`), png);
      report.outputs[`${name}.png`] = sha256(png);
      report.checks[name] = checks;
      const failed = checks.filter((c) => !c.passed);
      console.log(`${failed.length === 0 ? "ok  " : "FAIL"} ${name}.png  ${failed.map((c) => c.name).join(", ")}`);
    }

    lap("stills and checks");

    // Reproducibility: a fresh page must give the same bytes, for the end state and a mid-motion frame.
    const probe = jobs[0];
    if (probe !== undefined) {
      const repro: Check[] = [];
      for (const t of [undefined, 2.5]) {
        const hashes: string[] = [];
        for (let i = 0; i < 2; i++) {
          const page = await openScene(browser, campaign.page, probe.data);
          hashes.push(sha256(await still(page, t)));
          await page.close();
        }
        repro.push({
          name: `same bytes twice at t=${t === undefined ? "end" : String(t)}`,
          passed: hashes[0] === hashes[1],
          detail: hashes.map((h) => h.slice(0, 16)).join(" / "),
        });
      }
      report.checks["reproducibility"] = repro;
      for (const c of repro) console.log(`${c.passed ? "ok  " : "FAIL"} ${c.name}  ${c.detail}`);
    }

    lap("reproducibility");

    // Motion: the same scene sampled at every frame, then encoded. Skipped with --stills.
    for (const [variantId, formatName] of stillsOnly ? [] : campaign.motion) {
      const job = jobs.find((j) => j.variant.id === variantId && j.formatName === formatName);
      // campaignProblems has refused unknown pairs before anything rendered.
      if (job === undefined) throw new Error(`no job for motion pair ${variantId}/${formatName}`);
      const name = `${variantId}-${formatName}`;
      const page = await openScene(browser, campaign.page, job.data);
      const mp4 = join(OUT, `${name}.mp4`);
      await run(
        FFMPEG,
        ["-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(tokens.motion.fps), "-i", "-",
          "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", mp4],
        frames(page, job.data.lengthS, tokens.motion.fps),
      );
      await page.close();
      report.outputs[`${name}.mp4`] = sha256(await readFile(mp4));
      lap("film: frames and mp4");
      const gif = join(OUT, `${name}.gif`);
      await run(FFMPEG, ["-loglevel", "error", "-y", "-i", mp4, "-vf",
        // Film grain changes every frame; smoothed before the palette, a GIF shows the picture, not the noise.
        "fps=15,scale=720:-1:flags=lanczos,hqdn3d=4:3:8:8,split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
        gif]);
      report.outputs[`${name}.gif`] = sha256(await readFile(gif));
      lap("film: gif");
      console.log(`ok   ${name}.mp4 + .gif`);
    }

    // Print: same scene, end state, text kept as vector glyphs.
    report.checks["pdf"] = [];
    for (const [variantId, formatName] of stillsOnly ? [] : campaign.print) {
      const printJob = jobs.find((j) => j.variant.id === variantId && j.formatName === formatName);
      if (printJob === undefined) throw new Error(`no job for print pair ${variantId}/${formatName}`);
      const name = `${variantId}-${formatName}.pdf`;
      const page = await openScene(browser, campaign.page, printJob.data);
      await page.evaluate(() => { window.seek(window.LANGD); });
      const pdfPath = join(OUT, name);
      await page.pdf({ path: pdfPath, width: `${String(printJob.format.width)}px`, height: `${String(printJob.format.height)}px`, printBackground: true, pageRanges: "1" });
      await page.close();
      const fonts = await run(PDFFONTS, [pdfPath]);
      for (const family of new Set(Object.values(tokens.type).map((role) => role.family))) {
        const check = { name: `${name} embeds ${family}`, passed: fonts.includes(family.replaceAll(" ", "")), detail: "text stays vector, font embedded" };
        report.checks["pdf"].push(check);
        console.log(`${check.passed ? "ok  " : "FAIL"} ${check.name}`);
      }
      report.outputs[name] = sha256(await readFile(pdfPath));
      lap("pdf");
    }
  } finally {
    await browser.close();
  }

  const all = Object.values(report.checks).flat();
  if (campaign.rhetoric !== undefined) {
    report.rhetoric = rhetoricReport(campaign.rhetoric, all);
    for (const c of report.rhetoric.criteria) {
      const held = c.evidence.filter((e) => e.passed).length;
      console.log(`     ${c.appeal.padEnd(6)} ${c.id.padEnd(20)} ${String(held)}/${String(c.evidence.length)} supporting checks, ${c.judgement}`);
    }
  }
  report.notes.push(
    `${String(all.filter((c) => c.passed).length)}/${String(all.length)} technical checks passed`,
    "Technical checks do not judge the design. Visual approval is a human decision.",
    ...Object.entries(report.assets).map(([name, asset]) => `${name}: ${asset}`),
    `rendered in ${((Date.now() - started) / 1000).toFixed(1)} s (${Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(1)} s`).join(", ")})`,
    ...(stillsOnly ? ["--stills: film and print skipped"] : []),
  );
  await writeFile(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(report.notes.join("\n"));
  if (all.some((c) => !c.passed)) process.exitCode = 1;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  await main(args.find((a) => !a.startsWith("--")) ?? "design/campaign.json", args.includes("--stills"));
}
