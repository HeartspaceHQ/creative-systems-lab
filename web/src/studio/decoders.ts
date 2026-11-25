import { DecodeError, bool, field, num, oneOf, optBool, optNum, optStr, rec, str, text } from "../decode";
import type {
  Asset,
  AssetDecision,
  AssetSource,
  Brand,
  Brief,
  Copy,
  Delivery,
  DeliveryCheck,
  Design,
  FontOption,
  Format,
  Output,
  Project,
  ProjectSummary,
  Reference,
  RoleStyle,
} from "./types";
import type { Job } from "../types";
import { job as legacyJob } from "../decoders";

const KINDS = ["illustration", "photo"] as const;
const SHAPES = ["square", "portrait", "landscape"] as const;
const ORIGINS = ["generated", "imported"] as const;
const ASSET_STATUSES = ["pending", "approved", "rejected"] as const;
const LAYOUTS = ["editorial", "cinema"] as const;
const OUTPUT_KINDS = ["png", "mp4", "gif", "pdf"] as const;
const DELIVERY_STATES = ["running", "done", "failed"] as const;
const FONT_KINDS = ["serif", "sans", "uploaded"] as const;

function reference(value: unknown): Reference {
  const o = rec(value, "reference");
  return { id: str(o, "id"), name: str(o, "name"), url: str(o, "url") };
}

export function brand(value: unknown): Brand {
  const o = rec(value, "brand");
  const colours = rec(o["colours"], "colours");
  const type = rec(o["type"], "type");
  return {
    id: str(o, "id"),
    name: str(o, "name"),
    colours: {
      ground: str(colours, "ground"),
      text: str(colours, "text"),
      quiet: str(colours, "quiet"),
      accent: str(colours, "accent"),
    },
    type: { display: str(type, "display"), body: str(type, "body") },
    styleNote: optStr(o, "style_note") ?? "",
    references: field(o, "references", reference),
    updatedAt: optStr(o, "updated_at") ?? "",
  };
}

export const brands = (value: unknown): Brand[] => (Array.isArray(value) ? (value as unknown[]).map(brand) : []);

function roleStyle(value: unknown, path: string): RoleStyle {
  const o = rec(value, path);
  return { weight: num(o, "weight"), tracking: num(o, "tracking"), leading: num(o, "leading") };
}

export function font(value: unknown): FontOption {
  const o = rec(value, "font");
  const [lo, hi, ...rest] = field(o, "weights", (w) => (typeof w === "number" ? w : Number.NaN));
  if (lo === undefined || hi === undefined || rest.length > 0 || Number.isNaN(lo + hi)) {
    throw new DecodeError("font.weights is not a pair of numbers");
  }
  return {
    family: str(o, "family"),
    url: str(o, "url"),
    weights: [lo, hi],
    kind: oneOf(o, "kind", FONT_KINDS),
    display: roleStyle(o["display"], "font.display"),
    body: roleStyle(o["body"], "font.body"),
    label: roleStyle(o["label"], "font.label"),
  };
}

export const fonts = (value: unknown): FontOption[] => (Array.isArray(value) ? (value as unknown[]).map(font) : []);

export function formats(value: unknown): Format[] {
  return (Array.isArray(value) ? (value as unknown[]) : []).map((item) => {
    const o = rec(item, "format");
    return { key: str(o, "key"), label: str(o, "label"), width: num(o, "width"), height: num(o, "height") };
  });
}

export const DEFAULT_BRIEF: Brief = { subject: "", kind: "photo", shape: "portrait", candidates: 4 };

function brief(value: unknown): Brief {
  if (value === null || value === undefined) return DEFAULT_BRIEF;
  const o = rec(value, "brief");
  return {
    subject: optStr(o, "subject") ?? "",
    kind: oneOf(o, "kind", KINDS),
    shape: oneOf(o, "shape", SHAPES),
    candidates: num(o, "candidates"),
  };
}

function assetSource(value: unknown): AssetSource {
  if (value === null || value === undefined) {
    return { runId: null, candidateId: null, model: null, licence: null, fileName: null };
  }
  const o = rec(value, "source");
  return {
    runId: optStr(o, "run_id"),
    candidateId: optStr(o, "candidate_id"),
    model: optStr(o, "model"),
    licence: optStr(o, "licence"),
    fileName: optStr(o, "file_name"),
  };
}

function assetDecision(value: unknown): AssetDecision | null {
  if (value === null || value === undefined) return null;
  const o = rec(value, "decision");
  return {
    verdict: oneOf(o, "verdict", ["approve", "reject"] as const),
    reviewer: str(o, "reviewer"),
    note: optStr(o, "note") ?? "",
    decidedAt: optStr(o, "decided_at") ?? "",
    rightsConfirmed: optBool(o, "rights_confirmed") ?? false,
  };
}

export function asset(value: unknown): Asset {
  const o = rec(value, "asset");
  return {
    id: str(o, "id"),
    url: str(o, "url"),
    width: num(o, "width"),
    height: num(o, "height"),
    sha256: optStr(o, "sha256") ?? "",
    origin: oneOf(o, "origin", ORIGINS),
    source: assetSource(o["source"]),
    status: oneOf(o, "status", ASSET_STATUSES),
    decision: assetDecision(o["decision"]),
  };
}

function copy(value: unknown): Copy {
  const o = rec(value, "copy");
  return {
    label: optStr(o, "label") ?? "",
    headline: optStr(o, "headline") ?? "",
    body: optStr(o, "body") ?? "",
    cta: optStr(o, "cta") ?? "",
    sender: optStr(o, "sender") ?? "",
  };
}

function design(value: unknown): Design | null {
  if (value === null || value === undefined) return null;
  const o = rec(value, "design");
  const focus = rec(o["focus"], "focus");
  return {
    asset: str(o, "asset"),
    layout: oneOf(o, "layout", LAYOUTS),
    copy: copy(o["copy"]),
    focus: { x: num(focus, "x"), y: num(focus, "y") },
    zoom: num(o, "zoom"),
    headlineScale: num(o, "headline_scale"),
    night: optNum(o, "night") ?? 0,
  };
}

function output(value: unknown): Output {
  const o = rec(value, "output");
  return {
    name: str(o, "name"),
    kind: oneOf(o, "kind", OUTPUT_KINDS),
    format: str(o, "format"),
    width: num(o, "width"),
    height: num(o, "height"),
    bytes: num(o, "bytes"),
    url: str(o, "url"),
  };
}

function check(value: unknown): DeliveryCheck {
  const o = rec(value, "check");
  return { name: str(o, "name"), passed: bool(o, "passed"), detail: optStr(o, "detail") ?? "" };
}

export function delivery(value: unknown): Delivery {
  const o = rec(value, "delivery");
  return {
    id: str(o, "id"),
    createdAt: optStr(o, "created_at") ?? "",
    state: oneOf(o, "state", DELIVERY_STATES),
    error: optStr(o, "error"),
    formats: field(o, "formats", text),
    extras: field(o, "extras", text),
    outputs: field(o, "outputs", output),
    checks: field(o, "checks", check),
  };
}

export function project(value: unknown): Project {
  const o = rec(value, "project");
  return {
    id: str(o, "id"),
    name: str(o, "name"),
    brand: str(o, "brand"),
    createdAt: optStr(o, "created_at") ?? "",
    updatedAt: optStr(o, "updated_at") ?? "",
    brief: brief(o["brief"]),
    runs: field(o, "runs", text),
    assets: field(o, "assets", asset),
    design: design(o["design"]),
    deliveries: field(o, "deliveries", delivery),
  };
}

export function projectSummaries(value: unknown): ProjectSummary[] {
  return (Array.isArray(value) ? (value as unknown[]) : []).map((item) => {
    const o = rec(item, "project");
    return {
      id: str(o, "id"),
      name: str(o, "name"),
      brand: str(o, "brand"),
      updatedAt: optStr(o, "updated_at") ?? "",
      coverUrl: optStr(o, "cover_url"),
    };
  });
}

/** `POST /api/projects/<p>/runs` answers `{ job }`, where job is the job's id or the job itself. */
export function startedJob(value: unknown): Job {
  const o = rec(value, "job");
  const inner = o["job"];
  if (typeof inner === "string") return { id: inner, state: "running", runId: null, error: null };
  return legacyJob(inner ?? value);
}
