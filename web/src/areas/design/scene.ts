/** Turns the designer's drafts into what the preview shows, tolerating what is half typed. */
import { normaliseHex } from "../../studio/colour";
import { brandToWire, designToWire, fontToWire } from "../../studio/wire";
import type { Asset, Brand, BrandDraft, ColourRole, Design, FontOption } from "../../studio/types";
import type { PreviewScene } from "./preview";

const ROLES: readonly ColourRole[] = ["ground", "text", "quiet", "accent"];
const PLACEHOLDER_HEADLINE = "Your headline";

/** The draft brand, with anything not yet usable (a half-typed colour, two equal fonts) taken from the saved brand. */
export function usableBrand(draft: BrandDraft, saved: Brand): BrandDraft {
  const colours = Object.fromEntries(ROLES.map((role) => [role, normaliseHex(draft.colours[role]) ?? saved.colours[role]])) as BrandDraft["colours"];
  const sameFonts = draft.type.display === draft.type.body;
  return {
    name: draft.name.trim() === "" ? saved.name : draft.name,
    colours,
    type: sameFonts ? saved.type : draft.type,
    styleNote: draft.styleNote,
  };
}

export function previewScene(
  brand: BrandDraft,
  saved: Brand,
  design: Design,
  asset: Asset,
  format: string,
  fonts: readonly FontOption[],
): PreviewScene {
  const shown: Design = {
    ...design,
    copy: { ...design.copy, headline: design.copy.headline.trim() === "" ? PLACEHOLDER_HEADLINE : design.copy.headline },
  };
  return {
    brand: brandToWire(usableBrand(brand, saved)),
    design: designToWire(shown),
    imageUrl: asset.url,
    format,
    fonts: fonts.map(fontToWire),
  };
}

const TEXT_NAMES: Readonly<Record<string, string>> = {
  headline: "the headline",
  deck: "the body text",
  kicker: "the label",
  steep: "the detail line",
  cta: "the call to action",
  wordmark: "the sender name",
  folio: "the page marker",
};

/** The text that does not fit, in plain words, with what to do about it. */
export function overflowSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const words = names.map((n) => TEXT_NAMES[n] ?? n);
  const list = words.length === 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
  const fix = names.includes("headline") ? "Shorten the headline or lower its size." : "Shorten the text.";
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${words.length === 1 ? "does" : "do"}n't fit in this size. ${fix}`;
}
