import { job, modelOptions, quote, setup } from "../decoders";
import { getJson, sendJson, uploadFont, uploadImage } from "../http";
import type { Job, ModelOption, Quote, Setup } from "../types";
import { asset, brand, brands, delivery, font, fonts, formats, project, projectSummaries, startedJob } from "./decoders";
import type { Asset, Brand, BrandDraft, Brief, Delivery, Design, FontOption, Format, Project, ProjectSummary } from "./types";
import { brandToWire, briefToWire, designToWire } from "./wire";

const p = (id: string): string => `/api/projects/${encodeURIComponent(id)}`;
const b = (id: string): string => `/api/brands/${encodeURIComponent(id)}`;

export interface AssetDecisionInput {
  readonly verdict: "approve" | "reject";
  readonly reviewer: string;
  readonly note: string;
  readonly rightsConfirmed: boolean;
}

export const studioApi = {
  fonts: async (): Promise<FontOption[]> => fonts(await getJson("/api/fonts")),
  /** Keep a font file under `family`; the designer has confirmed they may use it. */
  addFont: async (file: File, family: string): Promise<FontOption> =>
    font(await uploadFont(`/api/fonts?${new URLSearchParams({ family, rights: "confirmed" }).toString()}`, file)),
  formats: async (): Promise<Format[]> => formats(await getJson("/api/formats")),
  setup: async (): Promise<Setup> => setup(await getJson("/api/setup")),

  brands: async (): Promise<Brand[]> => brands(await getJson("/api/brands")),
  createBrand: async (input: BrandDraft): Promise<Brand> => brand(await sendJson("POST", "/api/brands", brandToWire(input))),
  saveBrand: async (id: string, input: BrandDraft): Promise<Brand> =>
    brand(await sendJson("PUT", b(id), brandToWire(input))),
  addReference: async (id: string, file: File): Promise<Brand> =>
    brand(await uploadImage(`${b(id)}/references`, file)),
  removeReference: async (id: string, reference: string): Promise<Brand> =>
    brand(await sendJson("DELETE", `${b(id)}/references/${encodeURIComponent(reference)}`)),

  projects: async (): Promise<ProjectSummary[]> => projectSummaries(await getJson("/api/projects")),
  createProject: async (name: string, brandId: string): Promise<Project> =>
    project(await sendJson("POST", "/api/projects", { name, brand: brandId })),
  project: async (id: string): Promise<Project> => project(await getJson(p(id))),
  renameProject: async (id: string, name: string): Promise<Project> => project(await sendJson("PUT", p(id), { name })),
  setProjectBrand: async (id: string, brandId: string): Promise<Project> =>
    project(await sendJson("PUT", p(id), { brand: brandId })),
  saveBrief: async (id: string, brief: Brief): Promise<Project> =>
    project(await sendJson("PUT", `${p(id)}/brief`, briefToWire(brief))),
  saveDesign: async (id: string, design: Design): Promise<Project> =>
    project(await sendJson("PUT", `${p(id)}/design`, designToWire(design))),

  models: async (id: string): Promise<ModelOption[]> => modelOptions(await getJson(`${p(id)}/models`)),
  quote: async (id: string, models: readonly string[], candidates: number): Promise<Quote> => {
    const query = new URLSearchParams({ models: models.join(","), candidates: String(candidates) });
    return quote(await getJson(`${p(id)}/quote?${query.toString()}`));
  },
  startRun: async (id: string, models: readonly string[], candidates: number): Promise<Job> =>
    startedJob(await sendJson("POST", `${p(id)}/runs`, { models, candidates })),
  job: async (jobId: string): Promise<Job> => job(await getJson(`/api/jobs/${encodeURIComponent(jobId)}`)),

  assetFromRun: async (id: string, run: string, candidate: string): Promise<Asset> =>
    asset(await sendJson("POST", `${p(id)}/assets/from-run`, { run, candidate })),
  importImage: async (id: string, file: File): Promise<Asset> => asset(await uploadImage(`${p(id)}/assets/import`, file)),
  decideAsset: async (id: string, assetId: string, input: AssetDecisionInput): Promise<Asset> =>
    asset(
      await sendJson("POST", `${p(id)}/assets/${encodeURIComponent(assetId)}/decision`, {
        verdict: input.verdict,
        reviewer: input.reviewer,
        note: input.note,
        rights_confirmed: input.rightsConfirmed,
      }),
    ),

  createDelivery: async (id: string, selectedFormats: readonly string[], extras: readonly string[]): Promise<Delivery> =>
    delivery(await sendJson("POST", `${p(id)}/deliveries`, { formats: selectedFormats, extras })),
  delivery: async (id: string, deliveryId: string): Promise<Delivery> =>
    delivery(await getJson(`${p(id)}/deliveries/${encodeURIComponent(deliveryId)}`)),

  setKey: async (variable: string, value: string): Promise<void> => {
    await sendJson("POST", "/api/keys", { variable, value });
  },
  approveBudget: async (approvedUsd: number, approvedBy: string): Promise<void> => {
    await sendJson("POST", "/api/budget", { approved_usd: approvedUsd, approved_by: approvedBy });
  },
  forgetKey: async (variable: string): Promise<void> => {
    await sendJson("DELETE", `/api/keys/${encodeURIComponent(variable)}`);
  },
};

export const zipUrl = (projectId: string, deliveryId: string): string =>
  `${p(projectId)}/deliveries/${encodeURIComponent(deliveryId)}/zip`;
export const downloadUrl = (url: string): string => `${url}${url.includes("?") ? "&" : "?"}download=1`;
