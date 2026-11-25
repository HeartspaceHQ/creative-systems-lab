/** One list of everything the designer can look at: project images and run candidates not yet adopted. */
import { imageUrl } from "../../api";
import { modelName } from "../../studio/models";
import type { Asset } from "../../studio/types";
import type { Candidate, RunDetail } from "../../types";

export type ItemState = "review" | "approved" | "rejected";

export interface Origin {
  readonly run: RunDetail;
  readonly candidate: Candidate;
}

export interface LibraryItem {
  readonly key: string;
  readonly src: string;
  readonly state: ItemState;
  /** The automatic checks flagged it; the designer can still approve it knowingly. */
  readonly flagged: boolean;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly asset: Asset | null;
  readonly origin: Origin | null;
}

const assetState = (asset: Asset): ItemState =>
  asset.status === "approved" ? "approved" : asset.status === "rejected" ? "rejected" : "review";

function fromAsset(asset: Asset, runs: readonly RunDetail[]): LibraryItem {
  const run = runs.find((r) => r.id === asset.source.runId);
  const candidate = run?.candidates.find((c) => c.id === asset.source.candidateId);
  const title =
    asset.origin === "imported"
      ? `Imported: ${asset.source.fileName ?? "image"}`
      : `Made by ${modelName(asset.source.model ?? "", asset.source.model ?? "a model")}`;
  return {
    key: `asset:${asset.id}`,
    src: asset.url,
    state: assetState(asset),
    flagged: false,
    width: asset.width,
    height: asset.height,
    title,
    asset,
    origin: run !== undefined && candidate !== undefined ? { run, candidate } : null,
  };
}

function fromCandidate(run: RunDetail, candidate: Candidate): LibraryItem {
  const state: ItemState =
    candidate.status === "approved" ? "approved" : candidate.status === "rejected" ? "rejected" : "review";
  return {
    key: `candidate:${run.id}:${candidate.id}`,
    src: imageUrl.candidate(run.id, candidate.id),
    state,
    flagged: !candidate.hardPass,
    width: candidate.width,
    height: candidate.height,
    title: `Made by ${modelName(candidate.model, candidate.modelLabel)}`,
    asset: null,
    origin: { run, candidate },
  };
}

export function buildLibrary(assets: readonly Asset[], runs: readonly RunDetail[]): LibraryItem[] {
  const adopted = new Set(assets.map((a) => `${a.source.runId ?? ""}:${a.source.candidateId ?? ""}`));
  const candidates = runs.flatMap((run) =>
    run.candidates.filter((c) => !adopted.has(`${run.id}:${c.id}`)).map((c) => fromCandidate(run, c)),
  );
  return [...assets.map((a) => fromAsset(a, runs)), ...candidates];
}

export const GROUPS: readonly { state: ItemState; title: string }[] = [
  { state: "review", title: "To review" },
  { state: "approved", title: "Approved" },
  { state: "rejected", title: "Rejected" },
];
