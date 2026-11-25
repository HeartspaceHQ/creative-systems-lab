export type Status = "auto_rejected" | "pending" | "approved" | "rejected";
export type Verdict = "approve" | "reject";

export interface Explanation {
  readonly measured: string;
  readonly outcome: string;
  readonly consequence: string;
  readonly blindSpot: string;
}

export interface Check {
  readonly name: string;
  readonly value: number;
  readonly threshold: number;
  readonly comparison: string;
  readonly passed: boolean;
  readonly hard: boolean;
  readonly explanation: Explanation;
}

export interface Decision {
  readonly candidateId: string;
  readonly verdict: Verdict;
  readonly reviewer: string;
  readonly note: string;
  readonly override: boolean;
  readonly decidedAt: string;
}

/** One dominant colour of an image, matched to the nearest brand palette colour. */
export interface ColourMatch {
  readonly hex: string;
  readonly share: number;
  readonly nearest: string;
  readonly deltaE: number;
  readonly neutral: boolean;
  readonly within: boolean;
}

export interface Candidate {
  readonly id: string;
  readonly status: Status;
  readonly model: string;
  readonly modelId: string;
  readonly modelLabel: string;
  readonly seed: number;
  readonly steps: number;
  readonly width: number;
  readonly height: number;
  readonly prompt: string;
  readonly seconds: number;
  readonly createdAt: string;
  readonly costUsd: number | null;
  readonly costEstimated: boolean | null;
  readonly sha256: string;
  /** Set when the candidate was generated in another run and rechecked here. */
  readonly sourceRun: string | null;
  readonly hardPass: boolean;
  readonly colours: readonly ColourMatch[];
  readonly checks: readonly Check[];
  readonly warnings: readonly string[];
  readonly decision: Decision | null;
}

export interface Verification {
  readonly intact: boolean;
  /** False for a run without an integrity manifest: nothing was sealed, so nothing can be intact. */
  readonly sealed: boolean;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

export interface PaletteColour {
  readonly name: string;
  readonly hex: string;
}

/** A reference image the run measured drift against; `available` once the file still matches. */
export interface ReferenceImage {
  readonly name: string;
  readonly available: boolean;
}

export type Kind = "illustration" | "photo";

export interface RunDetail {
  readonly id: string;
  readonly subject: string;
  readonly briefId: string;
  readonly kind: Kind;
  readonly startedAt: string | null;
  readonly brandName: string;
  readonly brandVersion: string;
  readonly palette: readonly PaletteColour[];
  readonly paletteMaxDeltaE: number;
  readonly rechecked: readonly string[];
  readonly references: readonly ReferenceImage[];
  readonly candidates: readonly Candidate[];
  readonly decisions: readonly Decision[];
  readonly verification: Verification;
}

export interface RunSummary {
  readonly id: string;
  readonly subject: string;
  readonly kind: Kind;
  readonly startedAt: string | null;
  readonly rechecked: boolean;
  readonly models: readonly string[];
  readonly cover: string | null;
  readonly candidates: number;
  readonly pending: number;
  readonly approved: number;
  readonly rejected: number;
  readonly heldBack: number;
}

export interface BriefOption {
  readonly file: string;
  readonly subject: string;
  readonly kind: Kind;
  readonly candidates: number;
}

export interface ModelOption {
  readonly key: string;
  readonly description: string;
  readonly licence: string;
  readonly location: "local" | "hosted";
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly excludedReason: string | null;
  readonly perImageUsd: number | null;
  readonly priceConfirmed: boolean;
  readonly priceSource: string;
}

export interface BudgetStatus {
  readonly id: string;
  readonly approvedUsd: number;
  readonly remainingUsd: number;
  /** Settled calls with a cost the provider reported. */
  readonly chargedUsd: number;
  /** Failed calls whose charge cannot be known; kept as spend. */
  readonly uncertainUsd: number;
  /** Reserved by calls that are still running. */
  readonly heldUsd: number;
  readonly approvedBy: string | null;
  readonly approvedOn: string | null;
}

export interface ProviderStatus {
  readonly variable: string;
  readonly name: string;
  readonly set: boolean;
  /** Where a set key came from: pasted in the studio, or given to the studio in the terminal. */
  readonly source: KeySource | null;
  readonly models: readonly string[];
}

export type KeySource = "studio" | "terminal";

export interface LocalModelStatus {
  readonly key: string;
  readonly description: string;
  readonly reason: string | null;
}

export interface Setup {
  readonly local: readonly LocalModelStatus[];
  readonly providers: readonly ProviderStatus[];
  readonly budget: BudgetStatus | null;
}

export interface QuoteLine {
  readonly key: string;
  readonly free: boolean;
  readonly perImageUsd: number;
  readonly heldUsd: number;
  readonly confirmed: boolean;
}

export interface Quote {
  readonly candidates: number;
  readonly images: number;
  readonly lines: readonly QuoteLine[];
  readonly totalHeldUsd: number;
  readonly budget: BudgetStatus | null;
  readonly fits: boolean;
}

export interface Job {
  readonly id: string;
  readonly state: "running" | "done" | "failed";
  readonly runId: string | null;
  readonly error: string | null;
}

export interface BlindItem {
  readonly id: string;
  readonly verdict: Verdict | null;
  readonly note: string;
}
