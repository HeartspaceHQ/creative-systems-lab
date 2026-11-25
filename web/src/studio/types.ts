import type { Kind } from "../types";

export type ColourRole = "ground" | "text" | "quiet" | "accent";
export type Colours = Readonly<Record<ColourRole, string>>;

export interface BrandType {
  readonly display: string;
  readonly body: string;
}

/** How a family is set in one role: weight, letter spacing in em and line height. */
export interface RoleStyle {
  readonly weight: number;
  readonly tracking: number;
  readonly leading: number;
}

export type FontKind = "serif" | "sans" | "uploaded";

/** A font on offer: bundled with the engine, or uploaded to this studio. */
export interface FontOption {
  readonly family: string;
  /** `fonts/<file>` for a bundled font (beside the engine), `/api/fonts/<id>/file` for an uploaded one. */
  readonly url: string;
  readonly weights: readonly [number, number];
  readonly kind: FontKind;
  readonly display: RoleStyle;
  readonly body: RoleStyle;
  readonly label: RoleStyle;
}

export interface Reference {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

export interface Brand {
  readonly id: string;
  readonly name: string;
  readonly colours: Colours;
  readonly type: BrandType;
  readonly styleNote: string;
  readonly references: readonly Reference[];
  readonly updatedAt: string;
}

/** The part of a brand the designer edits; the id and references are managed separately. */
export interface BrandDraft {
  readonly name: string;
  readonly colours: Colours;
  readonly type: BrandType;
  readonly styleNote: string;
}

export type Shape = "square" | "portrait" | "landscape";

export interface Brief {
  readonly subject: string;
  readonly kind: Kind;
  readonly shape: Shape;
  readonly candidates: number;
}

export type AssetOrigin = "generated" | "imported";
export type AssetStatus = "pending" | "approved" | "rejected";

export interface AssetSource {
  readonly runId: string | null;
  readonly candidateId: string | null;
  readonly model: string | null;
  readonly licence: string | null;
  readonly fileName: string | null;
}

export interface AssetDecision {
  readonly verdict: "approve" | "reject";
  readonly reviewer: string;
  readonly note: string;
  readonly decidedAt: string;
  readonly rightsConfirmed: boolean;
}

export interface Asset {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly origin: AssetOrigin;
  readonly source: AssetSource;
  readonly status: AssetStatus;
  readonly decision: AssetDecision | null;
}

export type Layout = "editorial" | "cinema";

export interface Copy {
  readonly label: string;
  readonly headline: string;
  readonly body: string;
  readonly cta: string;
  readonly sender: string;
}

export interface Focus {
  readonly x: number;
  readonly y: number;
}

export interface Design {
  readonly asset: string;
  readonly layout: Layout;
  readonly copy: Copy;
  readonly focus: Focus;
  readonly zoom: number;
  readonly headlineScale: number;
  readonly night: number;
}

export type OutputKind = "png" | "mp4" | "gif" | "pdf";
export type Extra = "mp4" | "gif" | "pdf";

export interface Output {
  readonly name: string;
  readonly kind: OutputKind;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly url: string;
}

export interface DeliveryCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface Delivery {
  readonly id: string;
  readonly createdAt: string;
  readonly state: "running" | "done" | "failed";
  readonly error: string | null;
  readonly formats: readonly string[];
  readonly extras: readonly string[];
  readonly outputs: readonly Output[];
  readonly checks: readonly DeliveryCheck[];
}

export interface Format {
  readonly key: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly brief: Brief;
  readonly runs: readonly string[];
  readonly assets: readonly Asset[];
  readonly design: Design | null;
  readonly deliveries: readonly Delivery[];
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly updatedAt: string;
  readonly coverUrl: string | null;
}

export type Area = "brief" | "images" | "design" | "deliver";
