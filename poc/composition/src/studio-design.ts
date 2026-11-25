/**
 * CSL Studio's design model: a brand, a design and an approved image become the engine's own design
 * source (tokens, campaign, asset manifest) and, for the live preview, the data one scene is built
 * from. Pure and browser-safe: the preview in the studio and the delivery renderer share this one
 * mapping, so what the designer sees is what is rendered.
 */
import { contrast, luminance } from "./checks.ts";
import { sceneData } from "./resolve.ts";
import type { AssetManifest, Campaign, Composition, Copy, FaceSource, Format, Hex, Layer, SceneData, Tokens, TypeRole, Variant } from "./types.ts";

type RoleStyle = Omit<TypeRole, "family">;

/**
 * A font the studio offers: the file, the weights it covers, and how it is set in each role. The
 * studio sends the list with every scene, the bundled fonts from `fonts/catalog.json` and the ones
 * the designer uploaded; a brand may only name families on it.
 */
export interface StudioFace {
  readonly family: string;
  /** Same-origin URL of the file: `fonts/<file>` (the engine's own or the delivery's), or `/api/fonts/<id>/file`. */
  readonly url: string;
  readonly weights: readonly [number, number];
  readonly display: RoleStyle;
  readonly body: RoleStyle;
  readonly label: RoleStyle;
}

export const STUDIO_LAYOUTS = ["editorial", "cinema"] as const;
export type StudioLayout = (typeof STUDIO_LAYOUTS)[number];

export const STUDIO_EXTRAS = ["mp4", "gif", "pdf"] as const;
export type StudioExtra = (typeof STUDIO_EXTRAS)[number];

export interface StudioFormat {
  readonly key: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export const STUDIO_FORMATS: readonly StudioFormat[] = [
  { key: "linkedin-portrait", label: "LinkedIn portrait", width: 1080, height: 1350 },
  { key: "linkedin-square", label: "LinkedIn square", width: 1080, height: 1080 },
  { key: "linkedin-landscape", label: "LinkedIn link image", width: 1200, height: 627 },
  { key: "story", label: "Story", width: 1080, height: 1920 },
  { key: "wide", label: "Wide 16:9", width: 1920, height: 1080 },
];

export interface StudioBrand {
  readonly name: string;
  readonly colours: { readonly ground: Hex; readonly text: Hex; readonly quiet: Hex; readonly accent: Hex };
  readonly type: { readonly display: string; readonly body: string };
}

export interface StudioCopy {
  readonly label: string;
  readonly headline: string;
  readonly body: string;
  readonly cta: string;
  readonly sender: string;
}

export interface StudioDesign {
  readonly asset: string;
  readonly layout: StudioLayout;
  readonly copy: StudioCopy;
  readonly focus: { readonly x: number; readonly y: number };
  readonly zoom: number;
  readonly headline_scale: number;
  readonly night: number;
}

/** An approved image as the delivery renderer receives it: the file, its hash and its provenance. */
export interface StudioAsset {
  /** Where the PNG is in the project, `assets/<id>.png`. */
  readonly path: string;
  readonly sha256: string;
  readonly approved_by: string;
  readonly approved_for: readonly "render"[];
  readonly run_id: string;
  readonly candidate_id: string;
  readonly recipe_hash: string;
  readonly model: string;
  readonly licence: string;
  readonly alt?: string;
}

export interface StudioOptions {
  readonly formats: readonly string[];
  readonly extras: readonly StudioExtra[];
}

export interface StudioSource {
  readonly tokens: Tokens;
  readonly campaign: Campaign;
  readonly manifest: AssetManifest;
  /** Project-relative path of the manifest, which `campaign.asset` names. */
  readonly manifestPath: string;
}

/** What is wrong with the input, in words a designer reads, by the dotted path of the field. */
export class StudioError extends Error {
  readonly fields: Readonly<Record<string, string>>;

  constructor(fields: Readonly<Record<string, string>>) {
    super(Object.values(fields).join(" "));
    this.name = "StudioError";
    this.fields = fields;
  }
}

/** The one variant and the one layer a studio design is made of. */
export const STUDIO_VARIANT = "design";
const STUDIO_LAYER = "brand";
const CAMPAIGN_ID = "studio";

/** The pages the layouts run in. */
const PAGES: Readonly<Record<StudioLayout, string>> = { editorial: "editorial.html", cinema: "cinema.html" };
/** The length the cinematic timeline was directed at; the editorial page uses the token default. */
const CINEMA_LENGTH_S = 10;

const RANGES = {
  zoom: [0.5, 2],
  headline_scale: [0.5, 2],
  night: [0, 1],
  focus: [0, 1],
} as const;

/** Limits that keep a pasted essay out of a headline field; the layout reports what still does not fit. */
const LIMITS = { name: 60, label: 60, headlineLines: 5, headlineLine: 60, body: 400, cta: 120, sender: 60 } as const;

/** The design rules every studio design is checked against: the same as the engine's own tokens. */
const RULES: Tokens["rules"] = {
  min_contrast_body: 4.5,
  min_contrast_large: 3.0,
  accent_is_text: false,
  // Lower than the first campaign's 4.0: a long post headline shrinks to fit, and the body must stay readable.
  display_to_body_min_ratio: 2.5,
  min_body_px: 16,
  safe_margin_u: 6,
};

const MOTION: Tokens["motion"] = { length_s: 6, fps: 30, ring_ripple_s: 2.4, steep_arc_s: 4.0 };

/** At most this many fonts in one list: the bundled ones and what a designer uploads. */
const MAX_FACES = 64;
/** A family name that is safe inside a quoted CSS font-family. */
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 .&'-]{0,59}$/;
/** A font file the studio serves itself; never another origin. */
const FACE_URL = /^(?:fonts\/[A-Za-z0-9][\w.-]*\.(?:woff2|woff|ttf|otf)|\/api\/fonts\/[a-z0-9][a-z0-9-]*\/file)$/;
const ROLE_RANGES = { weight: [1, 1000], tracking: [-0.1, 0.3], leading: [0.8, 2] } as const;

/** The colour of low sun: the hot core of the cinema light is the accent lifted toward it. */
const SUNLIGHT: Hex = "#fff0d8";
/** Relative luminance where white and black text have equal contrast: below it a ground reads as dark. */
const DARK_GROUND_BELOW = 0.179;
/** How far the quiet colour moves toward the text colour where it sits on a photograph. */
const QUIET_ON_PHOTO = 0.75;

const HEX = /^#[0-9a-f]{6}$/i;
const isHex = (value: string): value is Hex => HEX.test(value);
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Linear mix of two colours; t = 0 gives a, t = 1 gives b. */
export function mix(a: Hex, b: Hex, t: number): Hex {
  const channels = (hex: Hex): readonly number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [from, to] = [channels(a), channels(b)];
  const out = from.map((v, i) => Math.round(v + ((to[i] ?? v) - v) * t).toString(16).padStart(2, "0"));
  return `#${out.join("")}`;
}

/** The colour roles the cinema light needs, derived from the four a brand gives. */
export function derivedColours(colours: StudioBrand["colours"]): { line: Hex; light: Hex; glow: Hex; warmth: Hex } {
  const dark = luminance(colours.ground) < DARK_GROUND_BELOW;
  return {
    line: colours.text,
    light: mix(colours.accent, SUNLIGHT, 0.6),
    glow: colours.accent,
    // The shadows of a cinematic scene warm toward this. On a dark ground it is a deep accent, on a
    // light one barely a tint, so the haze that carries the text stays light.
    warmth: mix(colours.ground, colours.accent, dark ? 0.6 : 0.3),
  };
}

/**
 * The cinema layout is a dark room with light words, as it was directed: a brand with a light ground
 * gives its text colour to the shadows and its ground to the words. A light haze over a photograph
 * washed the picture out, and the pair keeps the contrast the brand already has.
 */
export function cinemaColours(colours: StudioBrand["colours"]): StudioBrand["colours"] {
  if (luminance(colours.ground) < luminance(colours.text)) return colours;
  const ground = colours.text;
  const text = colours.ground;
  // An accent chosen for a light page can vanish in the dark: it is lifted toward the words until it reads.
  return { ...colours, ground, text, accent: readableOn(colours.accent, text, ground, RULES.min_contrast_large) };
}

/** `colour` mixed toward `toward` in tenths, just far enough to reach `floor` against `ground`. */
function readableOn(colour: Hex, toward: Hex, ground: Hex, floor: number): Hex {
  for (let step = 0; step <= 10; step++) {
    const tried = mix(colour, toward, step / 10);
    if (contrast(tried, ground) >= floor) return tried;
  }
  return toward;
}

/**
 * The brand's tokens for one layout. The quiet colour is meant for a flat ground; on a photograph the
 * cinema layout puts the kicker in it over a haze, where it fell below the engine's legibility floor
 * with every palette tried, so there it is drawn halfway toward the text colour.
 */
export function studioTokens(brand: StudioBrand, faces: readonly StudioFace[], layout: StudioLayout = "editorial"): Tokens {
  const colours = layout === "cinema" ? cinemaColours(brand.colours) : brand.colours;
  const { ground, text, accent } = colours;
  const quiet = layout === "cinema" ? mix(colours.quiet, text, QUIET_ON_PHOTO) : colours.quiet;
  const { line, light, glow, warmth } = derivedColours(colours);
  const display = faceOf(faces, brand.type.display);
  const body = faceOf(faces, brand.type.body);
  const layer: Layer = {
    ground: "ground", text: "text", quiet: "quiet", accent: "accent", line: "line", light: "light", glow: "glow", warmth: "warmth",
  };
  return {
    colour: { ground, text, quiet, accent, line, light, glow, warmth },
    layers: { [STUDIO_LAYER]: layer },
    type: {
      display: { family: display.family, ...display.display },
      body: { family: body.family, ...body.body },
      label: { family: body.family, ...body.label },
    },
    faces: [display, body].map(faceSource),
    rules: RULES,
    motion: MOTION,
  };
}

/** The face of a family on the list; a parsed brand only names families that are on it. */
function faceOf(faces: readonly StudioFace[], family: string): StudioFace {
  const face = faces.find((f) => f.family === family);
  if (face === undefined) throw new StudioError({ type: `The font ${family} is not available.` });
  return face;
}

const faceSource = (face: StudioFace): FaceSource =>
  ({ family: face.family, url: face.url, weight: `${String(face.weights[0])} ${String(face.weights[1])}` });

/** The lines of a headline: split on newlines, trimmed, empty lines dropped. */
export const headlineLines = (headline: string): string[] =>
  headline.split("\n").map((line) => line.trim()).filter((line) => line !== "");

/** A page's manifest path for a PNG: the same name with `.json`. */
export const manifestPathOf = (png: string): string => png.replace(/\.png$/, ".json");

function composition(design: StudioDesign): Composition {
  return { zoom: design.zoom, headline: design.headline_scale, night: design.night, framing: "whole" };
}

function copyOf(design: StudioDesign): Copy {
  const { label, headline, body, cta } = design.copy;
  return { label: label.trim(), headline: headlineLines(headline), body: body.trim(), cta: cta.trim() };
}

function campaignOf(brand: StudioBrand, design: StudioDesign, manifestPath: string, options: StudioOptions): Campaign {
  const first = options.formats[0];
  const motion = options.extras.some((e) => e === "mp4" || e === "gif") && first !== undefined ? [[STUDIO_VARIANT, first] as const] : [];
  const print = options.extras.includes("pdf") && first !== undefined ? [[STUDIO_VARIANT, first] as const] : [];
  const variant: Variant = { id: STUDIO_VARIANT, layer: STUDIO_LAYER };
  const formats: Record<string, Format> = {};
  for (const key of options.formats) {
    const format = STUDIO_FORMATS.find((f) => f.key === key);
    if (format !== undefined) formats[key] = { width: format.width, height: format.height };
  }
  return {
    id: CAMPAIGN_ID,
    page: PAGES[design.layout],
    brand: design.copy.sender.trim() || brand.name,
    asset: manifestPath,
    copy: copyOf(design),
    variants: [variant],
    formats,
    motion,
    print,
    ...(design.layout === "cinema" ? { length_s: CINEMA_LENGTH_S } : {}),
    composition: composition(design),
  };
}

function manifestOf(design: StudioDesign, asset: StudioAsset): AssetManifest {
  return {
    path: asset.path,
    sha256: asset.sha256,
    focus: design.focus,
    source: {
      run_id: asset.run_id,
      candidate_id: asset.candidate_id,
      recipe_hash: asset.recipe_hash,
      model: asset.model,
      licence: asset.licence,
      approved_by: asset.approved_by,
      approved_for: asset.approved_for,
    },
    ...(asset.alt === undefined ? {} : { alt: asset.alt }),
  };
}

/** The sizes and extras of a delivery from their wire shape: `{ formats, extras }`. */
export function parseOptions(input: unknown): StudioOptions {
  const source = raw(input);
  const fields: Fields = {};
  const known = new Set(STUDIO_FORMATS.map((f) => f.key));
  const formats = source["formats"];
  if (!Array.isArray(formats) || formats.length === 0) fields["formats"] = "Pick at least one size.";
  else if (!formats.every((f) => typeof f === "string" && known.has(f))) fields["formats"] = "Pick sizes from the list.";
  else if (new Set(formats).size !== formats.length) fields["formats"] = "Each size can be picked once.";
  const extras = source["extras"] ?? [];
  if (!Array.isArray(extras) || !extras.every((e) => STUDIO_EXTRAS.some((x) => x === e))) fields["extras"] = "Pick extras from the list.";
  finish(fields);
  return {
    formats: (formats as unknown[]).map(String),
    extras: STUDIO_EXTRAS.filter((e) => (extras as unknown[]).includes(e)),
  };
}

/** The engine's design source for a studio project: what the delivery renderer writes to disk. */
export function studioSource(brandInput: unknown, designInput: unknown, assetInput: unknown, optionsInput: unknown, facesInput: unknown): StudioSource {
  const faces = parseFaces(facesInput);
  const brand = parseBrand(brandInput, faces);
  const design = parseDesign(designInput);
  const asset = parseAsset(assetInput);
  const options = parseOptions(optionsInput);
  const manifestPath = manifestPathOf(asset.path);
  return {
    tokens: studioTokens(brand, faces, design.layout),
    campaign: campaignOf(brand, design, manifestPath, options),
    manifest: manifestOf(design, asset),
    manifestPath,
  };
}

/** The data one scene is built from, for the live preview: built through the engine's own `sceneData`. */
export function studioSceneData(brandInput: unknown, designInput: unknown, imageUrl: string, formatKey: string, facesInput: unknown): SceneData {
  const faces = parseFaces(facesInput);
  const brand = parseBrand(brandInput, faces);
  const design = parseDesign(designInput);
  const format = STUDIO_FORMATS.find((f) => f.key === formatKey);
  if (format === undefined) throw new StudioError({ format: "Pick a size from the list." });
  const preview: StudioAsset = {
    path: imageUrl, sha256: "", approved_by: "preview", approved_for: ["render"],
    run_id: "", candidate_id: "", recipe_hash: "", model: "", licence: "",
  };
  const campaign = campaignOf(brand, design, manifestPathOf(imageUrl), { formats: [formatKey], extras: [] });
  const variant: Variant = { id: STUDIO_VARIANT, layer: STUDIO_LAYER };
  return sceneData(studioTokens(brand, faces, design.layout), campaign, manifestOf(design, preview), variant, { width: format.width, height: format.height });
}

type Fields = Record<string, string>;
type Raw = Readonly<Record<string, unknown>>;

const raw = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};

function finish(fields: Fields): void {
  if (Object.keys(fields).length > 0) throw new StudioError(fields);
}

function str(source: Raw, key: string, path: string, max: number, fields: Fields, required = false): string {
  const value = source[key];
  if (typeof value !== "string") {
    fields[path] = "This needs some text.";
    return "";
  }
  if (required && value.trim() === "") fields[path] = "This cannot be empty.";
  else if (value.length > max) fields[path] = `Keep this under ${String(max)} characters.`;
  return value;
}

function colour(source: Raw, key: string, fields: Fields): Hex {
  const value = source[key];
  if (typeof value === "string" && isHex(value.trim())) return value.trim().toLowerCase() as Hex;
  fields[`colours.${key}`] = "Use a colour like #1d2a3a.";
  return "#000000";
}

function font(source: Raw, key: string, faces: readonly StudioFace[], fields: Fields): string {
  const value = source[key];
  const found = faces.find((f) => f.family === value);
  if (found !== undefined) return found.family;
  fields[`type.${key}`] = `Pick one of the available fonts: ${faces.map((f) => f.family).join(", ")}.`;
  return "";
}

function roleStyle(source: Raw, path: string, fields: Fields): RoleStyle {
  return {
    weight: inRange(source, "weight", `${path}.weight`, ROLE_RANGES.weight, fields),
    tracking: inRange(source, "tracking", `${path}.tracking`, ROLE_RANGES.tracking, fields),
    leading: inRange(source, "leading", `${path}.leading`, ROLE_RANGES.leading, fields),
  };
}

function face(input: unknown, index: number, fields: Fields): StudioFace {
  const source = raw(input);
  const path = `fonts.${String(index)}`;
  const family = source["family"];
  const url = source["url"];
  const weights = source["weights"];
  if (typeof family !== "string" || !FAMILY.test(family)) fields[`${path}.family`] = "Name the font with letters, digits, spaces, dots, dashes or &.";
  if (typeof url !== "string" || !FACE_URL.test(url)) fields[`${path}.url`] = "The font file must be one the studio serves.";
  const [lo, hi] = Array.isArray(weights) ? (weights as unknown[]) : [];
  const range = typeof lo === "number" && typeof hi === "number" && Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && lo <= hi && hi <= 1000;
  if (!range) fields[`${path}.weights`] = "Give the weights the file covers, like [400, 900].";
  return {
    family: String(family),
    url: String(url),
    weights: range ? [lo, hi] : [400, 400],
    display: roleStyle(raw(source["display"]), `${path}.display`, fields),
    body: roleStyle(raw(source["body"]), `${path}.body`, fields),
    label: roleStyle(raw(source["label"]), `${path}.label`, fields),
  };
}

/** The fonts on offer from their wire shape: a list of faces, each family once. */
export function parseFaces(input: unknown): StudioFace[] {
  const fields: Fields = {};
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_FACES) {
    throw new StudioError({ fonts: `Send between 1 and ${String(MAX_FACES)} fonts.` });
  }
  const faces = (input as unknown[]).map((item, i) => face(item, i, fields));
  if (new Set(faces.map((f) => f.family)).size !== faces.length) fields["fonts"] = "Each font family can be on the list once.";
  finish(fields);
  return faces;
}

function inRange(source: Raw, key: string, path: string, [lo, hi]: readonly [number, number], fields: Fields): number {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi) return value;
  fields[path] = `Use a number from ${String(lo)} to ${String(hi)}.`;
  return lo;
}

/** A brand from its wire shape; extra fields (id, references, notes) are left alone. */
export function parseBrand(input: unknown, faces: readonly StudioFace[]): StudioBrand {
  const source = raw(input);
  const fields: Fields = {};
  const colours = raw(source["colours"]);
  const type = raw(source["type"]);
  const brand: StudioBrand = {
    name: str(source, "name", "name", LIMITS.name, fields, true).trim(),
    colours: {
      ground: colour(colours, "ground", fields),
      text: colour(colours, "text", fields),
      quiet: colour(colours, "quiet", fields),
      accent: colour(colours, "accent", fields),
    },
    type: { display: font(type, "display", faces, fields), body: font(type, "body", faces, fields) },
  };
  // The engine's own rule: a headline and its text are two voices, not one.
  if (brand.type.display === brand.type.body && fields["type.display"] === undefined && fields["type.body"] === undefined) {
    fields["type.body"] = "Pick a different font than the headline font, so the two read as two voices.";
  }
  finish(fields);
  return brand;
}

/** A design from its wire shape, with every range checked. */
export function parseDesign(input: unknown): StudioDesign {
  const source = raw(input);
  const fields: Fields = {};
  const copy = raw(source["copy"]);
  const focus = raw(source["focus"]);
  const asset = source["asset"];
  if (typeof asset !== "string" || !SLUG.test(asset)) fields["asset"] = "Pick an approved image for the design.";
  const layout = STUDIO_LAYOUTS.find((l) => l === source["layout"]);
  if (layout === undefined) fields["layout"] = "Pick a layout: editorial or cinema.";
  const headline = str(copy, "headline", "copy.headline", LIMITS.headlineLines * (LIMITS.headlineLine + 1), fields, true);
  const lines = headlineLines(headline);
  if (fields["copy.headline"] === undefined && (lines.length > LIMITS.headlineLines || lines.some((l) => l.length > LIMITS.headlineLine))) {
    fields["copy.headline"] = `Use at most ${String(LIMITS.headlineLines)} lines of ${String(LIMITS.headlineLine)} characters.`;
  }
  const design: StudioDesign = {
    asset: typeof asset === "string" ? asset : "",
    layout: layout ?? "editorial",
    copy: {
      label: str(copy, "label", "copy.label", LIMITS.label, fields),
      headline,
      body: str(copy, "body", "copy.body", LIMITS.body, fields),
      cta: str(copy, "cta", "copy.cta", LIMITS.cta, fields),
      sender: str(copy, "sender", "copy.sender", LIMITS.sender, fields),
    },
    focus: { x: inRange(focus, "x", "focus.x", RANGES.focus, fields), y: inRange(focus, "y", "focus.y", RANGES.focus, fields) },
    zoom: inRange(source, "zoom", "zoom", RANGES.zoom, fields),
    headline_scale: inRange(source, "headline_scale", "headline_scale", RANGES.headline_scale, fields),
    night: inRange(source, "night", "night", RANGES.night, fields),
  };
  finish(fields);
  return design;
}

/** An approved image as the delivery receives it. Provenance the server does not have is recorded as unknown. */
export function parseAsset(input: unknown): StudioAsset {
  const source = raw(input);
  const fields: Fields = {};
  const path = source["path"];
  if (typeof path !== "string" || !/^assets\/[a-z0-9][a-z0-9-]*\.png$/.test(path)) fields["path"] = "The image must be a PNG in the project's assets folder.";
  const sha256 = source["sha256"];
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) fields["sha256"] = "The image needs its SHA-256 hash.";
  const approvedBy = str(source, "approved_by", "approved_by", 200, fields, true);
  const approvedFor = source["approved_for"];
  if (approvedFor !== undefined && !(Array.isArray(approvedFor) && approvedFor.includes("render"))) {
    fields["approved_for"] = "The image is not approved for rendering.";
  }
  const optional = (key: string, fallback: string): string => {
    const value = source[key];
    return typeof value === "string" && value !== "" ? value : fallback;
  };
  const alt = source["alt"];
  finish(fields);
  return {
    path: typeof path === "string" ? path : "",
    sha256: typeof sha256 === "string" ? sha256 : "",
    approved_by: approvedBy,
    approved_for: ["render"],
    run_id: optional("run_id", "imported"),
    candidate_id: optional("candidate_id", typeof sha256 === "string" ? sha256.slice(0, 12) : ""),
    recipe_hash: optional("recipe_hash", ""),
    model: optional("model", "imported image"),
    licence: optional("licence", "Rights confirmed by the reviewer in CSL Studio"),
    ...(typeof alt === "string" && alt !== "" ? { alt } : {}),
  };
}
