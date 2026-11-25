/** Shared shapes for the design source, the scene and the renderer. */

import type { Shape } from "./shape.ts";

export type ColourName = string;
export type Hex = `#${string}`;

export interface Layer {
  readonly ground: ColourName;
  readonly text: ColourName;
  readonly quiet: ColourName;
  readonly accent: ColourName;
  readonly line: ColourName;
  /** Light falling into a scene: its hot core, its falloff, and the colour shadows warm toward. */
  readonly light: ColourName;
  readonly glow: ColourName;
  readonly warmth: ColourName;
}

export interface TypeRole {
  readonly family: string;
  readonly weight: number;
  readonly tracking: number;
  readonly leading: number;
}

/** A font file a page loads itself, for a family no stylesheet declares. */
export interface FaceSource {
  readonly family: string;
  /** Same-origin URL of the file, relative to the page or from the root. */
  readonly url: string;
  /** The CSS weight range the file covers, as `font-weight` takes it: "400 900". */
  readonly weight: string;
}

export interface Tokens {
  readonly colour: Readonly<Record<ColourName, Hex>>;
  readonly layers: Readonly<Record<string, Layer>>;
  readonly type: { readonly display: TypeRole; readonly body: TypeRole; readonly label: TypeRole };
  /** Fonts to load before the type roles: the families the page's stylesheets do not declare. */
  readonly faces?: readonly FaceSource[];
  readonly rules: {
    readonly min_contrast_body: number;
    readonly min_contrast_large: number;
    readonly accent_is_text: boolean;
    readonly display_to_body_min_ratio: number;
    /** Body text never sets smaller than this, in CSS pixels, whatever the canvas. */
    readonly min_body_px: number;
    readonly safe_margin_u: number;
  };
  readonly motion: {
    readonly length_s: number;
    readonly fps: number;
    readonly ring_ripple_s: number;
    readonly steep_arc_s: number;
  };
}

export interface Copy {
  readonly label: string;
  readonly headline: readonly string[];
  readonly body: string;
  /** A timed instruction, drawn as a line that fills while the film runs. Absent: no timer row. */
  readonly steep?: { readonly temperature_c: number; readonly minutes: number };
  readonly cta: string;
  /** Running head of an editorial page; scenes without one ignore it. */
  readonly folio?: string;
}

export interface Format {
  readonly width: number;
  readonly height: number;
  /**
   * Art direction per format: an asset manifest for this format only. Formats without one use the
   * campaign's asset, so one photograph serves every format where it works.
   */
  readonly asset?: string;
}

/**
 * The few composition parameters a campaign may set without touching scene code. Every field is a
 * factor or a share, so 1 (or absent) keeps the scene as designed.
 */
export interface Composition {
  /** How close the camera frames the photograph, relative to the scene's own framing. */
  readonly zoom?: number;
  /** How dark the opening frame lies over the photograph, 0..1. */
  readonly night?: number;
  /** Size of the headline, relative to the scene's own type scale. */
  readonly headline?: number;
  /**
   * "close" (the default) frames the photograph as the scene was directed, for a photograph chosen
   * for it. "whole" starts from just covering the canvas, so any photograph keeps as much in view as
   * the format allows and the designer's zoom is the only closer framing.
   */
  readonly framing?: "close" | "whole";
}

export interface Variant {
  readonly id: string;
  readonly layer: string;
  readonly copy?: Partial<Copy>;
  readonly composition?: Composition;
  /** A different photograph for this variant: an asset manifest path. */
  readonly asset?: string;
}

/** One of Aristotle's proofs, or the fit to the moment (kairos, with decorum). */
export type Appeal = "kairos" | "ethos" | "pathos" | "logos";

/** A measurement the renderer can take for a criterion. Most criteria have none: they are judged. */
export interface WarmthRises {
  readonly kind: "warmth_rises";
  readonly from_s: number;
  readonly to_s: number;
}

export interface Criterion {
  readonly id: string;
  readonly appeal: Appeal;
  readonly criterion: string;
  /** Names (prefixes) of technical checks that support the criterion. They never prove it. */
  readonly evidence: readonly string[];
  readonly measure?: WarmthRises;
}

/** The rhetorical situation the design answers, and what the design must do in it. */
export interface Rhetoric {
  readonly situation: {
    readonly exigence: string;
    readonly audience: string;
    readonly constraints: readonly string[];
    readonly kairos: string;
  };
  readonly criteria: readonly Criterion[];
}

export interface Campaign {
  readonly id: string;
  /** The HTML page that hosts this campaign's scene module. */
  readonly page: string;
  /** Language of the copy, as a BCP 47 tag. Default "en". */
  readonly lang?: string;
  /** Prose for a technical section after the film on the web page (web-page.ts Explainer). */
  readonly explainer?: string;
  readonly brand: string;
  readonly asset: string;
  readonly copy: Copy;
  readonly variants: readonly Variant[];
  readonly formats: Readonly<Record<string, Format>>;
  /** [variant, format] pairs rendered as MP4 and GIF. */
  readonly motion: readonly (readonly [string, string])[];
  /** [variant, format] pairs exported as vector PDF. */
  readonly print: readonly (readonly [string, string])[];
  readonly length_s?: number;
  readonly composition?: Composition;
  readonly rhetoric?: Rhetoric;
}

/** A generated image used as one element of the composition, identified by its hash. */
export interface AssetManifest {
  readonly path: string;
  readonly sha256: string;
  /** Where the focal point sits in the source image, 0..1, chosen by the designer. */
  readonly focus: { readonly x: number; readonly y: number };
  /** Where light enters the photograph, 0..1; a scene with light places its source here. */
  readonly light?: { readonly x: number; readonly y: number };
  readonly source: {
    readonly run_id: string;
    readonly candidate_id: string;
    readonly recipe_hash: string;
    readonly model: string;
    readonly licence: string;
    readonly approved_by: string;
    /** What the approval covers: "render" for films and stills, "web" for a web page. */
    readonly approved_for?: readonly ("render" | "web")[];
  };
  /**
   * The formats this asset is directed for (art direction). Absent means any format. The renderer
   * refuses to place an asset in a format it was not chosen for.
   */
  readonly use?: readonly string[];
  /** What the photograph shows, for people who cannot see it. */
  readonly alt?: string;
}

/** Everything the scene needs for one render. Injected as window.__DATA. */
export interface SceneData {
  /** Length of the motion in seconds: the campaign's own, else the token default. */
  readonly lengthS: number;
  readonly tokens: Tokens;
  readonly layer: Layer;
  readonly copy: Copy;
  readonly brand: string;
  readonly format: Format;
  readonly imageUrl: string;
  readonly focus: { readonly x: number; readonly y: number };
  readonly light?: { readonly x: number; readonly y: number };
  readonly composition?: Composition;
  /** What the photograph shows, for people who cannot see it. */
  readonly alt?: string;
  /**
   * Where the scene runs. A rendered film or still (the default) is drawn once per frame offline; a
   * live web page is drawn on the viewer's device, so a scene may trade costly effects for cheap ones.
   */
  readonly medium?: "render" | "web";
  /** Pixels a web screen covers at each edge (a notch, a home indicator); the text stays clear of them. */
  readonly inset?: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What the scene reports about its own layout after seek(LANGD). */
export interface TextMeasure {
  readonly role: "display" | "body" | "label";
  readonly name: string;
  readonly box: Box;
  /** Width of the widest rendered line of text. The box of a block is the column; this is the ink. */
  readonly lineW: number;
  readonly fontSizePx: number;
  readonly fontWeight: number;
  readonly colour: string;
  readonly overflow: boolean;
  readonly fontFamily: string;
  /** Effective opacity, own times every ancestor's: below 1 the text is still fading in. */
  readonly opacity: number;
}

/**
 * Where a generated image sits on the canvas. Text must stay clear of every region, except a rect
 * marked `stage`: the image is then the scene itself and text may sit on it, provided it is legible
 * against the actual pixels behind it (measured by the renderer, not assumed).
 */
export type ImageRegion =
  | { readonly kind: "disc"; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: "rect"; readonly box: Box; readonly stage?: boolean };

export interface Measurement {
  readonly texts: readonly TextMeasure[];
  readonly images: readonly ImageRegion[];
  readonly ground: string;
  readonly safe: Box;
  readonly fontsLoaded: readonly string[];
}

/** One art-directed photograph for a web page; the browser picks the source from srcset and sizes. */
export interface WebArt {
  /** Width over height of the photograph. */
  readonly aspect: number;
  readonly focus: { readonly x: number; readonly y: number };
  readonly light?: { readonly x: number; readonly y: number };
  readonly alt?: string;
  readonly srcset: string;
  readonly sizes: string;
}

/**
 * Everything a web page needs, inlined in the page as JSON: the scene data without a fixed format,
 * and the photograph directed for each shape of screen.
 */
export interface WebScene {
  readonly scene: Omit<SceneData, "format" | "imageUrl" | "focus" | "alt" | "medium">;
  readonly art: Readonly<Record<Shape, WebArt>>;
  /** Scroll distance per second of the film, in CSS pixels: the same pace on every screen. */
  readonly pxPerSecond: number;
  /** Seconds of the film that play by themselves on arrival, so the message is there before any scroll. */
  readonly introS: number;
}
