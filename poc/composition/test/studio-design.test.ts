/**
 * Unit tests for CSL Studio's design model: how a brand, a design and an image become the engine's
 * design source, and which values are refused. Node only, no browser: `node --test test/`.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { contrast, sourceChecks } from "../src/checks.ts";
import { ENGINE, campaignProblems, moduleGraph } from "../src/source.ts";
import { writeStudioAssets } from "../src/studio-assets.ts";
import {
  STUDIO_FORMATS, StudioError, studioSceneData, studioSource, studioTokens, parseBrand, parseDesign, parseAsset, parseFaces, parseOptions,
} from "../src/studio-design.ts";
import type { Tokens } from "../src/types.ts";

const engineTokens = JSON.parse(await readFile(join(ENGINE, "design/tokens.json"), "utf8")) as Tokens;

interface CatalogEntry { readonly family: string; readonly file: string; readonly licence: string; readonly weights: readonly number[] }
const catalog = (JSON.parse(await readFile(join(ENGINE, "fonts/catalog.json"), "utf8")) as { fonts: (CatalogEntry & Record<string, unknown>)[] }).fonts;
/** The bundled fonts as the studio server sends them: the catalog with a URL for each file. */
const fonts = catalog.map((entry) => ({
  family: entry.family, url: `fonts/${entry.file}`, weights: entry.weights, display: entry["display"], body: entry["body"], label: entry["label"],
}));
const faces = parseFaces(fonts);

const brand = {
  id: "aster-lane-3f2a",
  name: "Aster Lane",
  colours: { ground: "#f4efe6", text: "#1d2a3a", quiet: "#5b6675", accent: "#b5542c" },
  type: { display: "Playfair Display", body: "DM Sans" },
  style_note: "warm natural light",
  references: [],
};
const design = {
  asset: "a7f3",
  layout: "cinema",
  copy: { label: "Winter blend", headline: "Slow mornings,\nwarm hands", body: "Black tea with orange peel.", cta: "asterlane.com", sender: "Aster Lane" },
  focus: { x: 0.5, y: 0.45 },
  zoom: 1.25,
  headline_scale: 0.9,
  night: 0.4,
};
const asset = { path: "assets/a7f3.png", sha256: "a".repeat(64), approved_by: "Sohrab", approved_for: ["render"] };
const options = { formats: ["linkedin-portrait", "story"], extras: ["mp4", "pdf"] };

/** The fields a refused input names. */
function refused(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof StudioError) return Object.keys(error.fields).sort();
    throw error;
  }
  return [];
}

void describe("STUDIO_FORMATS", () => {
  void it("are the five LinkedIn and screen sizes of the studio", () => {
    assert.deepEqual(STUDIO_FORMATS.map((f) => [f.key, f.width, f.height]), [
      ["linkedin-portrait", 1080, 1350], ["linkedin-square", 1080, 1080], ["linkedin-landscape", 1200, 627], ["story", 1080, 1920], ["wide", 1920, 1080],
    ]);
  });
});

void describe("studioTokens", () => {
  const tokens = studioTokens(parseBrand(brand, faces), faces);

  void it("gives the brand's four colours to one layer and derives the rest", () => {
    const layer = tokens.layers["brand"];
    assert.ok(layer !== undefined);
    assert.equal(tokens.colour[layer.ground], "#f4efe6");
    assert.equal(tokens.colour[layer.text], "#1d2a3a");
    assert.equal(tokens.colour[layer.quiet], "#5b6675");
    assert.equal(tokens.colour[layer.accent], "#b5542c");
    assert.equal(tokens.colour[layer.line], "#1d2a3a");
    for (const role of ["light", "glow", "warmth"] as const) assert.match(tokens.colour[layer[role]] ?? "", /^#[0-9a-f]{6}$/);
  });

  void it("lets the light be lighter than the accent it comes from", () => {
    const { accent, light } = tokens.colour;
    assert.ok(accent !== undefined && light !== undefined);
    assert.ok(contrast(light, "#000000") > contrast(accent, "#000000"));
  });

  void it("keeps the shadows of a light ground light and warms those of a dark one further", () => {
    const dark = studioTokens(parseBrand({ ...brand, colours: { ground: "#14213d", text: "#f5f1e8", quiet: "#c7c2b4", accent: "#fca311" } }, faces), faces);
    const rgb = (hex: string | undefined): number[] => [1, 3, 5].map((i) => parseInt((hex ?? "#000000").slice(i, i + 2), 16));
    const distance = (a: string | undefined, b: string | undefined): number => Math.hypot(...rgb(a).map((v, i) => v - (rgb(b)[i] ?? 0)));
    /** How far toward the accent the warmth lies from the ground, 0..1. */
    const share = (t: Tokens): number => distance(t.colour["ground"], t.colour["warmth"]) / distance(t.colour["ground"], t.colour["accent"]);
    assert.ok(Math.abs(share(tokens) - 0.3) < 0.02, `light ground: ${String(share(tokens))}`);
    assert.ok(Math.abs(share(dark) - 0.6) < 0.02, `dark ground: ${String(share(dark))}`);
  });

  void it("uses the engine's own rules (but a closer headline-to-body ratio), motion and type values for the families it already uses", () => {
    const withoutComment = (o: object): object => Object.fromEntries(Object.entries(o).filter(([key]) => !key.startsWith("$")));
    // One deliberate difference: a studio headline may stand closer to its body, so long headlines keep a readable body.
    assert.deepEqual(tokens.rules, { ...withoutComment(engineTokens.rules), display_to_body_min_ratio: 2.5 });
    assert.deepEqual(tokens.motion, withoutComment(engineTokens.motion));
    assert.deepEqual(tokens.type, engineTokens.type);
  });

  void it("sets a sans display and a serif body with their own weights", () => {
    const swapped = studioTokens(parseBrand({ ...brand, type: { display: "DM Sans", body: "Playfair Display" } }, faces), faces);
    assert.equal(swapped.type.display.family, "DM Sans");
    assert.equal(swapped.type.body.family, "Playfair Display");
    assert.equal(swapped.type.label.family, "Playfair Display");
    assert.ok(swapped.type.display.weight >= 500);
  });

  void it("moves the quiet colour toward the text only where it sits on a photograph", () => {
    assert.equal(tokens.colour["quiet"], "#5b6675");
    assert.equal(studioTokens(parseBrand(brand, faces), faces, "editorial").colour["quiet"], "#5b6675");
    assert.equal(studioTokens(parseBrand(brand, faces), faces, "cinema").colour["quiet"], "#cecdca");
  });

  void it("sets the cinema layout as a dark room with light words, whatever the brand's ground", () => {
    const light = studioTokens(parseBrand(brand, faces), faces, "cinema").colour;
    assert.equal(light["ground"], "#1d2a3a");
    assert.equal(light["text"], "#f4efe6");
    const greenAccent = studioTokens(parseBrand({ ...brand, colours: { ...brand.colours, accent: "#2f6b5a" } }, faces), faces, "cinema");
    assert.ok(sourceChecks(greenAccent).every((c) => c.passed), "a dark accent is lifted until it reads in the dark");
    const darkBrand = parseBrand({ ...brand, colours: { ground: "#14213d", text: "#f5f1e8", quiet: "#c7c2b4", accent: "#fca311" } }, faces);
    assert.equal(studioTokens(darkBrand, faces, "cinema").colour["ground"], "#14213d");
  });

  void it("passes the engine's source checks for a readable brand", () => {
    assert.deepEqual(sourceChecks(tokens).filter((c) => !c.passed), []);
  });
});

void describe("studioSource", () => {
  const source = studioSource(brand, design, asset, options, fonts);

  void it("makes one variant on one layer, with the design's copy and the sender as wordmark", () => {
    assert.deepEqual(source.campaign.variants, [{ id: "design", layer: "brand" }]);
    assert.equal(source.campaign.brand, "Aster Lane");
    assert.deepEqual(source.campaign.copy, { label: "Winter blend", headline: ["Slow mornings,", "warm hands"], body: "Black tea with orange peel.", cta: "asterlane.com" });
    assert.ok(!("steep" in source.campaign.copy) && !("folio" in source.campaign.copy));
  });

  void it("falls back to the brand name when there is no sender, and drops empty headline lines", () => {
    const plain = studioSource(brand, { ...design, copy: { ...design.copy, sender: " ", headline: "One\n\n  Two  \n" } }, asset, options, fonts);
    assert.equal(plain.campaign.brand, "Aster Lane");
    assert.deepEqual(plain.campaign.copy.headline, ["One", "Two"]);
  });

  void it("maps the composition and picks the page and film length by layout", () => {
    assert.deepEqual(source.campaign.composition, { zoom: 1.25, headline: 0.9, night: 0.4, framing: "whole" });
    assert.equal(source.campaign.page, "cinema.html");
    assert.equal(source.campaign.length_s, 10);
    const editorial = studioSource(brand, { ...design, layout: "editorial" }, asset, options, fonts);
    assert.equal(editorial.campaign.page, "editorial.html");
    assert.equal(editorial.campaign.length_s, undefined);
  });

  void it("renders the chosen sizes, and the film and the print from the first one", () => {
    assert.deepEqual(source.campaign.formats, { "linkedin-portrait": { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } });
    assert.deepEqual(source.campaign.motion, [["design", "linkedin-portrait"]]);
    assert.deepEqual(source.campaign.print, [["design", "linkedin-portrait"]]);
    const stills = studioSource(brand, design, asset, { formats: ["wide"], extras: [] }, fonts);
    assert.deepEqual([stills.campaign.motion, stills.campaign.print], [[], []]);
    const gif = studioSource(brand, design, asset, { formats: ["wide"], extras: ["gif"] }, fonts);
    assert.deepEqual([gif.campaign.motion, gif.campaign.print], [[["design", "wide"]], []]);
  });

  void it("describes the image by its manifest, with the design's focus and the approval", () => {
    assert.equal(source.manifestPath, "assets/a7f3.json");
    assert.equal(source.campaign.asset, "assets/a7f3.json");
    assert.equal(source.manifest.path, "assets/a7f3.png");
    assert.deepEqual(source.manifest.focus, { x: 0.5, y: 0.45 });
    assert.equal(source.manifest.source.approved_by, "Sohrab");
    assert.deepEqual(source.manifest.source.approved_for, ["render"]);
  });

  void it("is a campaign the engine's own checks accept", () => {
    assert.deepEqual(campaignProblems(source.tokens, source.campaign), []);
  });
});

void describe("studioSceneData", () => {
  void it("is built through the engine's sceneData for the chosen size", () => {
    const data = studioSceneData(brand, design, "/api/projects/p/assets/a7f3/image", "linkedin-landscape", fonts);
    assert.deepEqual(data.format, { width: 1200, height: 627 });
    assert.equal(data.imageUrl, "/api/projects/p/assets/a7f3/image");
    assert.deepEqual(data.focus, { x: 0.5, y: 0.45 });
    assert.deepEqual(data.composition, { zoom: 1.25, headline: 0.9, night: 0.4, framing: "whole" });
    assert.equal(data.brand, "Aster Lane");
    assert.equal(data.lengthS, 10);
    assert.equal(data.layer.ground, "ground");
    assert.equal(data.tokens.colour["quiet"], "#cecdca");
  });

  void it("shares its tokens, copy and composition with the delivery's source", () => {
    const data = studioSceneData(brand, design, "x.png", "story", fonts);
    const source = studioSource(brand, design, asset, { formats: ["story"], extras: [] }, fonts);
    assert.deepEqual(data.tokens, source.tokens);
    assert.deepEqual(data.copy, source.campaign.copy);
  });

  void it("refuses a size that is not offered", () => {
    assert.deepEqual(refused(() => studioSceneData(brand, design, "x.png", "poster", fonts)), ["format"]);
  });
});

void describe("what is refused", () => {
  void it("names every field of a brand that cannot be used, in the contract's paths", () => {
    const bad = { name: "", colours: { ground: "white", text: "#12345", quiet: 5, accent: "#GGGGGG" }, type: { display: "Comic Sans", body: "DM Sans" } };
    assert.deepEqual(refused(() => parseBrand(bad, faces)), ["colours.accent", "colours.ground", "colours.quiet", "colours.text", "name", "type.display"]);
  });

  void it("says what to do in a sentence", () => {
    try {
      parseBrand({ ...brand, colours: { ...brand.colours, ground: "white" } }, faces);
      assert.fail("accepted");
    } catch (error) {
      assert.ok(error instanceof StudioError);
      assert.equal(error.fields["colours.ground"], "Use a colour like #1d2a3a.");
    }
  });

  void it("accepts upper-case colours and writes them in lower case", () => {
    assert.equal(parseBrand({ ...brand, colours: { ...brand.colours, ground: "#F4EFE6" } }, faces).colours.ground, "#f4efe6");
  });

  void it("only takes font files the studio serves itself, each family once", () => {
    const [first] = fonts;
    if (first === undefined) assert.fail("the catalog is empty");
    assert.deepEqual(refused(() => parseFaces([{ ...first, url: "https://fonts.example/x.woff2" }])), ["fonts.0.url"]);
    assert.deepEqual(refused(() => parseFaces([{ ...first, family: 'Bad"Name' }])), ["fonts.0.family"]);
    assert.deepEqual(refused(() => parseFaces([{ ...first, weights: [900, 400] }])), ["fonts.0.weights"]);
    assert.deepEqual(refused(() => parseFaces([first, first])), ["fonts"]);
    assert.deepEqual(refused(() => parseFaces([])), ["fonts"]);
    assert.equal(parseFaces([{ ...first, url: "/api/fonts/f3a9c1/file" }])[0]?.url, "/api/fonts/f3a9c1/file");
  });

  void it("only takes a family that is on the list of fonts", () => {
    const uploaded = { ...fonts[1], family: "House Sans", url: "/api/fonts/f3a9c1/file", weights: [1, 1000] };
    const withUpload = parseFaces([...fonts, uploaded]);
    const tokens = studioTokens(parseBrand({ ...brand, type: { display: "Newsreader", body: "House Sans" } }, withUpload), withUpload);
    assert.deepEqual(tokens.faces, [
      { family: "Newsreader", url: "fonts/Newsreader-latin-var.woff2", weight: "200 800" },
      { family: "House Sans", url: "/api/fonts/f3a9c1/file", weight: "1 1000" },
    ]);
    assert.deepEqual(refused(() => parseBrand({ ...brand, type: { display: "Newsreader", body: "House Sans" } }, faces)), ["type.body"]);
  });

  void it("needs two different fonts, as the engine's source check does", () => {
    assert.deepEqual(refused(() => parseBrand({ ...brand, type: { display: "DM Sans", body: "DM Sans" } }, faces)), ["type.body"]);
  });

  void it("keeps focus in 0..1, zoom and headline scale in 0.5..2 and night in 0..1", () => {
    for (const [patch, field] of [
      [{ focus: { x: 1.1, y: 0.5 } }, "focus.x"], [{ focus: { x: 0.5, y: -0.1 } }, "focus.y"],
      [{ zoom: 0.4 }, "zoom"], [{ zoom: 2.1 }, "zoom"], [{ headline_scale: 0.49 }, "headline_scale"], [{ headline_scale: 3 }, "headline_scale"],
      [{ night: 1.01 }, "night"], [{ night: -0.01 }, "night"], [{ night: Number.NaN }, "night"], [{ zoom: "1" }, "zoom"],
    ] as const) {
      assert.deepEqual(refused(() => parseDesign({ ...design, ...patch })), [field], JSON.stringify(patch));
    }
    for (const patch of [{ zoom: 0.5 }, { zoom: 2 }, { headline_scale: 0.5 }, { night: 0 }, { night: 1 }, { focus: { x: 0, y: 1 } }]) {
      assert.deepEqual(refused(() => parseDesign({ ...design, ...patch })), [], JSON.stringify(patch));
    }
  });

  void it("needs a headline and a known layout, but lets the other copy be empty", () => {
    assert.deepEqual(refused(() => parseDesign({ ...design, copy: { ...design.copy, headline: " \n " } })), ["copy.headline"]);
    assert.deepEqual(refused(() => parseDesign({ ...design, layout: "poster" })), ["layout"]);
    assert.deepEqual(refused(() => parseDesign({ ...design, copy: { ...design.copy, label: "", body: "", cta: "", sender: "" } })), []);
  });

  void it("stops a pasted essay in a field", () => {
    assert.deepEqual(refused(() => parseDesign({ ...design, copy: { ...design.copy, body: "x".repeat(401) } })), ["copy.body"]);
    assert.deepEqual(refused(() => parseDesign({ ...design, copy: { ...design.copy, headline: "a\nb\nc\nd\ne\nf" } })), ["copy.headline"]);
  });

  void it("takes only an approved PNG of the project with its hash", () => {
    assert.deepEqual(refused(() => parseAsset({ ...asset, path: "../secret.png" })), ["path"]);
    assert.deepEqual(refused(() => parseAsset({ ...asset, path: "assets/a7f3.jpg" })), ["path"]);
    assert.deepEqual(refused(() => parseAsset({ ...asset, sha256: "abc" })), ["sha256"]);
    assert.deepEqual(refused(() => parseAsset({ ...asset, approved_by: " " })), ["approved_by"]);
    assert.deepEqual(refused(() => parseAsset({ ...asset, approved_for: ["web"] })), ["approved_for"]);
  });

  void it("takes sizes and extras only from the lists", () => {
    assert.deepEqual(refused(() => parseOptions({ formats: [], extras: [] })), ["formats"]);
    assert.deepEqual(refused(() => parseOptions({ formats: ["poster"], extras: [] })), ["formats"]);
    assert.deepEqual(refused(() => parseOptions({ formats: ["story", "story"], extras: [] })), ["formats"]);
    assert.deepEqual(refused(() => parseOptions({ formats: ["story"], extras: ["webm"] })), ["extras"]);
    assert.deepEqual(parseOptions({ formats: ["story"] }), { formats: ["story"], extras: [] });
  });

  void it("treats anything that is not an object as empty rather than crashing", () => {
    assert.ok(refused(() => parseBrand(null, faces)).length > 0);
    assert.ok(refused(() => parseDesign("x")).length > 0);
    assert.ok(refused(() => parseAsset([])).length > 0);
  });
});

void describe("the studio's browser files", () => {
  void it("keep Node out of the modules the preview imports", async () => {
    const modules = await moduleGraph(["studio-preview"]);
    assert.ok(modules.includes("studio-design") && modules.includes("resolve") && modules.includes("cinema") && modules.includes("editorial"));
    assert.ok(!modules.includes("source"), "the preview must not import the Node-only source module");
    for (const module of modules) assert.doesNotMatch(await readFile(join(ENGINE, `src/${module}.ts`), "utf8"), /from "node:/, module);
  });

  void it("bundle every catalog font as WOFF2 with its licence beside it", async () => {
    for (const entry of catalog) {
      const file = await readFile(join(ENGINE, "fonts", entry.file));
      assert.equal(file.subarray(0, 4).toString("latin1"), "wOF2", entry.file);
      assert.match(await readFile(join(ENGINE, "fonts", entry.licence), "utf8"), /SIL Open Font License, Version 1\.1/, entry.licence);
    }
  });

  void it("are written with types stripped and the stylesheets, fonts and page they need", async () => {
    const out = await mkdtemp(join(tmpdir(), "csl-studio-assets-"));
    try {
      const written = await writeStudioAssets(out);
      for (const file of ["studio.html", "editorial.css", "cinema.css", ...catalog.map((f) => `fonts/${f.file}`), "src/studio-preview.ts", "src/cinema.ts", "src/editorial.ts", "src/kit.ts", "src/studio-design.ts", "src/resolve.ts"]) {
        assert.ok(written.includes(file), `${file} missing from ${written.join(", ")}`);
      }
      const stripped = await readFile(join(out, "src/studio-design.ts"), "utf8");
      assert.doesNotMatch(stripped, /interface |: Hex|import type/);
      assert.match(stripped, /export function studioSource/);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
