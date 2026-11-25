import type { BrandDraft, Design } from "./types";

/** What a new brand starts from: neutral colours the designer replaces, the first two bundled fonts. */
export function newBrandDraft(name: string, fonts: readonly string[]): BrandDraft {
  const display = fonts.find((f) => f === "Playfair Display") ?? fonts[0] ?? "Playfair Display";
  const body = fonts.find((f) => f !== display) ?? display;
  return {
    name,
    colours: { ground: "#ffffff", text: "#1b1b1b", quiet: "#5b5b5b", accent: "#1257d6" },
    type: { display, body },
    styleNote: "",
  };
}

export function newDesign(asset: string, sender: string): Design {
  return {
    asset,
    layout: "editorial",
    copy: { label: "", headline: "", body: "", cta: "", sender },
    focus: { x: 0.5, y: 0.5 },
    zoom: 1,
    headlineScale: 1,
    night: 0,
  };
}
