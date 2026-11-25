import { bool, field, num, oneOf, optBool, optNum, optStr, rec, str, text } from "./decode";
import type {
  BlindItem,
  BriefOption,
  BudgetStatus,
  Candidate,
  Check,
  ColourMatch,
  Decision,
  Explanation,
  Job,
  ModelOption,
  Quote,
  ReferenceImage,
  RunDetail,
  RunSummary,
  Setup,
  Verification,
} from "./types";

const STATUSES = ["auto_rejected", "pending", "approved", "rejected"] as const;
const VERDICTS = ["approve", "reject"] as const;
const JOB_STATES = ["running", "done", "failed"] as const;
const KINDS = ["illustration", "photo"] as const;
const LOCATIONS = ["local", "hosted"] as const;
const KEY_SOURCES = ["studio", "terminal"] as const;

function explanation(value: unknown): Explanation {
  const o = rec(value, "explanation");
  return {
    measured: str(o, "measured"),
    outcome: str(o, "outcome"),
    consequence: str(o, "consequence"),
    blindSpot: str(o, "blind_spot"),
  };
}

function check(value: unknown): Check {
  const o = rec(value, "check");
  return {
    name: str(o, "name"),
    value: num(o, "value"),
    threshold: num(o, "threshold"),
    comparison: str(o, "comparison"),
    passed: bool(o, "passed"),
    hard: bool(o, "hard"),
    explanation: explanation(o["explanation"]),
  };
}

export function decision(value: unknown): Decision {
  const o = rec(value, "decision");
  return {
    candidateId: str(o, "candidate_id"),
    verdict: oneOf(o, "verdict", VERDICTS),
    reviewer: str(o, "reviewer"),
    note: str(o, "note"),
    override: bool(o, "override"),
    decidedAt: str(o, "decided_at"),
  };
}

function colourMatch(value: unknown): ColourMatch {
  const o = rec(value, "colour");
  return {
    hex: str(o, "hex"),
    share: num(o, "share"),
    nearest: str(o, "nearest"),
    deltaE: num(o, "delta_e"),
    neutral: bool(o, "neutral"),
    within: bool(o, "within"),
  };
}

function candidate(value: unknown): Candidate {
  const o = rec(value, "candidate");
  const latest = o["decision"];
  return {
    id: str(o, "id"),
    status: oneOf(o, "status", STATUSES),
    model: str(o, "model"),
    modelId: str(o, "model_id"),
    modelLabel: str(o, "model_label"),
    seed: num(o, "seed"),
    steps: num(o, "steps"),
    width: num(o, "width"),
    height: num(o, "height"),
    prompt: str(o, "prompt"),
    seconds: num(o, "seconds"),
    createdAt: str(o, "created_at"),
    costUsd: optNum(o, "cost_usd"),
    costEstimated: optBool(o, "cost_estimated"),
    sha256: str(o, "sha256"),
    sourceRun: optStr(o, "source_run"),
    hardPass: bool(o, "hard_pass"),
    colours: field(o, "colours", colourMatch),
    checks: field(o, "checks", check),
    warnings: field(o, "warnings", text),
    decision: latest === null || latest === undefined ? null : decision(latest),
  };
}

function verification(value: unknown): Verification {
  const o = rec(value, "verification");
  return {
    intact: bool(o, "intact"),
    sealed: bool(o, "sealed"),
    problems: field(o, "problems", text),
    warnings: field(o, "warnings", text),
  };
}

function referenceImage(value: unknown): ReferenceImage {
  const o = rec(value, "reference");
  return { name: str(o, "name"), available: bool(o, "available") };
}

export function runDetail(value: unknown): RunDetail {
  const o = rec(value);
  const brief = rec(o["brief"], "brief");
  const brand = rec(o["brand"], "brand");
  const palette = rec(brand["palette"], "palette");
  return {
    id: str(o, "id"),
    subject: str(brief, "subject"),
    briefId: str(brief, "id"),
    kind: oneOf(brief, "kind", KINDS),
    startedAt: optStr(o, "started_at"),
    brandName: str(brand, "name"),
    brandVersion: str(brand, "version"),
    palette: Object.entries(palette).map(([name, hex]) => ({ name, hex: text(hex) })),
    paletteMaxDeltaE: num(brand, "palette_max_delta_e"),
    rechecked: field(o, "rechecked_from", text),
    references: field(o, "references", referenceImage),
    candidates: field(o, "candidates", candidate),
    decisions: field(o, "decisions", decision),
    verification: verification(o["verification"]),
  };
}

export function runSummaries(value: unknown): RunSummary[] {
  return (Array.isArray(value) ? (value as unknown[]) : []).map((item) => {
    const o = rec(item, "run");
    return {
      id: str(o, "id"),
      subject: str(o, "subject"),
      kind: oneOf(o, "kind", KINDS),
      startedAt: optStr(o, "started_at"),
      rechecked: bool(o, "rechecked"),
      models: field(o, "models", text),
      cover: optStr(o, "cover"),
      candidates: num(o, "candidates"),
      pending: num(o, "pending"),
      approved: num(o, "approved"),
      rejected: num(o, "rejected"),
      heldBack: num(o, "held_back"),
    };
  });
}

export function briefOptions(value: unknown): BriefOption[] {
  return (Array.isArray(value) ? (value as unknown[]) : []).map((item) => {
    const o = rec(item, "brief");
    return {
      file: str(o, "file"),
      subject: str(o, "subject"),
      kind: oneOf(o, "kind", KINDS),
      candidates: num(o, "candidates"),
    };
  });
}

export function modelOptions(value: unknown): ModelOption[] {
  return (Array.isArray(value) ? (value as unknown[]) : []).map((item) => {
    const o = rec(item, "model");
    return {
      key: str(o, "key"),
      description: str(o, "description"),
      licence: str(o, "licence"),
      location: oneOf(o, "location", LOCATIONS),
      available: bool(o, "available"),
      unavailableReason: optStr(o, "unavailable_reason"),
      excludedReason: optStr(o, "excluded_reason") ?? optStr(o, "reason"),
      perImageUsd: optNum(o, "per_image_usd"),
      priceConfirmed: bool(o, "price_confirmed"),
      priceSource: str(o, "price_source"),
    };
  });
}

function budgetStatus(value: unknown): BudgetStatus | null {
  if (value === null || value === undefined) return null;
  const o = rec(value, "budget");
  return {
    id: str(o, "id"),
    approvedUsd: num(o, "approved_usd"),
    remainingUsd: num(o, "remaining_usd"),
    chargedUsd: optNum(o, "charged_usd") ?? 0,
    uncertainUsd: optNum(o, "uncertain_usd") ?? 0,
    heldUsd: optNum(o, "held_usd") ?? 0,
    approvedBy: optStr(o, "approved_by"),
    approvedOn: optStr(o, "approved_on"),
  };
}

export function setup(value: unknown): Setup {
  const o = rec(value, "setup");
  return {
    local: field(o, "local", (item) => {
      const entry = rec(item, "local model");
      return { key: str(entry, "key"), description: str(entry, "description"), reason: optStr(entry, "reason") };
    }),
    providers: field(o, "providers", (item) => {
      const entry = rec(item, "provider");
      return {
        variable: str(entry, "variable"),
        name: str(entry, "name"),
        set: bool(entry, "set"),
        source: entry["source"] === null ? null : oneOf(entry, "source", KEY_SOURCES),
        models: field(entry, "models", text),
      };
    }),
    budget: budgetStatus(o["budget"]),
  };
}

export function quote(value: unknown): Quote {
  const o = rec(value, "quote");
  return {
    candidates: num(o, "candidates"),
    images: num(o, "images"),
    lines: field(o, "lines", (item) => {
      const line = rec(item, "quote line");
      return {
        key: str(line, "key"),
        free: bool(line, "free"),
        perImageUsd: num(line, "per_image_usd"),
        heldUsd: num(line, "held_usd"),
        confirmed: bool(line, "confirmed"),
      };
    }),
    totalHeldUsd: num(o, "total_held_usd"),
    budget: budgetStatus(o["budget"]),
    fits: bool(o, "fits"),
  };
}

export function job(value: unknown): Job {
  const o = rec(value, "job");
  return {
    id: str(o, "id"),
    state: oneOf(o, "state", JOB_STATES),
    runId: optStr(o, "run_id"),
    error: optStr(o, "error"),
  };
}

export function blindItems(value: unknown): BlindItem[] {
  const o = rec(value);
  return field(o, "items", (item) => {
    const entry = rec(item, "item");
    const verdict = optStr(entry, "verdict");
    return {
      id: str(entry, "id"),
      verdict: verdict === "approve" || verdict === "reject" ? verdict : null,
      note: str(entry, "note"),
    };
  });
}
