/** The snake_case shapes the server and the preview harness speak. */
import type { Brand, BrandDraft, Brief, Design, FontOption } from "./types";

export function brandToWire(brand: BrandDraft): Record<string, unknown> {
  return {
    name: brand.name,
    colours: { ...brand.colours },
    type: { ...brand.type },
    style_note: brand.styleNote,
  };
}

/** A font as the preview harness takes it: where the file is, the weights it covers, how each role is set. */
export function fontToWire(font: FontOption): Record<string, unknown> {
  return {
    family: font.family,
    url: font.url,
    weights: [...font.weights],
    display: { ...font.display },
    body: { ...font.body },
    label: { ...font.label },
  };
}

export function briefToWire(brief: Brief): Record<string, unknown> {
  return { subject: brief.subject, kind: brief.kind, shape: brief.shape, candidates: brief.candidates };
}

export function designToWire(design: Design): Record<string, unknown> {
  return {
    asset: design.asset,
    layout: design.layout,
    copy: { ...design.copy },
    focus: { ...design.focus },
    zoom: design.zoom,
    headline_scale: design.headlineScale,
    night: design.night,
  };
}

export function draftOf(brand: Brand): BrandDraft {
  return { name: brand.name, colours: brand.colours, type: brand.type, styleNote: brand.styleNote };
}
