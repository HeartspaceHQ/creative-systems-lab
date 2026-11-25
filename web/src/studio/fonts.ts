/**
 * The fonts on offer, made usable in the studio's own page: each is added to `document.fonts` once,
 * from where the server serves it, so a sample is set in the real face before it is chosen.
 */
import { useEffect } from "react";
import type { FontKind, FontOption } from "./types";

/** The CSS stack for a family, falling back to the system face while the file loads. */
export function fontStack(family: string): string {
  return `"${family}", ui-sans-serif, system-ui, sans-serif`;
}

/** Bundled files sit beside the engine's preview page; an uploaded file's URL is already absolute. */
function fontHref(font: FontOption): string {
  return font.url.startsWith("/") ? font.url : `/engine/${font.url}`;
}

const added = new Map<string, FontFace>();

function addFace(font: FontOption): void {
  const href = fontHref(font);
  if (added.has(href)) return;
  const face = new FontFace(font.family, `url("${encodeURI(href)}")`, { weight: `${String(font.weights[0])} ${String(font.weights[1])}`, display: "swap" });
  document.fonts.add(face);
  added.set(href, face);
  face.load().catch(() => {
    // The sample falls back to the system face; the preview names the font that failed.
    document.fonts.delete(face);
    added.delete(href);
  });
}

/** Make every font on offer drawable in this page. */
export function useFontFaces(fonts: readonly FontOption[]): void {
  useEffect(() => {
    fonts.forEach(addFace);
  }, [fonts]);
}

export const FONT_GROUPS: readonly { readonly kind: FontKind; readonly label: string }[] = [
  { kind: "serif", label: "Serif" },
  { kind: "sans", label: "Sans serif" },
  { kind: "uploaded", label: "Your fonts" },
];

/** A family name suggested from a file name: `HouseSans-Bold.woff2` becomes `House Sans`. */
export function familyFromFileName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").split("-")[0] ?? "";
  const spaced = stem.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.replace(/[^A-Za-z0-9 .&']+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

const FONT_EXTENSIONS = [".woff2", ".woff", ".ttf", ".otf"];
export const FONT_ACCEPT = FONT_EXTENSIONS.join(",");
export const MAX_FONT_BYTES = 10 * 1024 * 1024;

/** Why a file cannot be uploaded as a font, before it is sent; the server checks the bytes again. */
export function fontFileProblem(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!FONT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "Upload a WOFF2, WOFF, TTF or OTF file.";
  if (file.size > MAX_FONT_BYTES) return "That font is larger than 10 MB.";
  return null;
}
