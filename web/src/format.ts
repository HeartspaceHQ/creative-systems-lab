/** Plain-language names and number formats shared by the review pages. */
import type { Check, Kind, Status } from "./types";

const CHECK_LABELS: Readonly<Record<string, string>> = {
  forbidden_colour_area: "Colours the brand avoids",
  palette_fit: "Fit to the brand palette",
  overlay_contrast: "Text readability over the image",
  colour_drift: "Colour match to the references",
  tone_drift: "Tone match to the references",
};

/** Checks whose value is a share of the image, shown as a percentage. */
const SHARE_CHECKS = new Set(["forbidden_colour_area", "palette_fit"]);

export const STATUS_LABELS: Readonly<Record<Status, string>> = {
  auto_rejected: "Flagged by checks",
  pending: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
};

export const KIND_LABELS: Readonly<Record<Kind, string>> = {
  illustration: "Illustration",
  photo: "Photograph",
};

export function checkLabel(name: string): string {
  return CHECK_LABELS[name] ?? name.replaceAll("_", " ");
}

export function percent(share: number): string {
  const value = share * 100;
  return `${value > 0 && value < 1 ? value.toFixed(1) : String(Math.round(value))}%`;
}

function measure(check: Check, value: number): string {
  if (SHARE_CHECKS.has(check.name)) return percent(value);
  if (check.name === "overlay_contrast") return `${value.toFixed(1)}:1`;
  return value.toFixed(2);
}

export function checkValue(check: Check): string {
  return measure(check, check.value);
}

export function checkLimit(check: Check): string {
  const bound = check.comparison === ">=" ? "at least" : "at most";
  return `${bound} ${measure(check, check.threshold)}`;
}

/** Where a value and its threshold sit on a 0–1 track, so a meter can draw both. */
export function meterPositions(check: Check): { value: number; threshold: number } {
  const top =
    SHARE_CHECKS.has(check.name) && check.comparison === ">="
      ? 1
      : Math.max(check.threshold * 2, check.value * 1.15, Number.EPSILON);
  const clamp = (n: number): number => Math.min(1, Math.max(0, n / top));
  return { value: clamp(check.value), threshold: clamp(check.threshold) };
}

export function dateTime(iso: string | null): string {
  if (iso === null) return "unknown time";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function seconds(value: number): string {
  return value < 10 ? `${value.toFixed(1)} s` : `${String(Math.round(value))} s`;
}

export function usd(value: number): string {
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** "just now", "5 minutes ago", "yesterday", or a date: how long ago something changed. */
export function since(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return plural(minutes, "minute ago", "minutes ago");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(hours, "hour ago", "hours ago");
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${String(days)} days ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
