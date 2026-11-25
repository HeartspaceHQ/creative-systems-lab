import { blindItems, briefOptions, decision, job, modelOptions, quote, runDetail, runSummaries, setup } from "./decoders";
import { getJson, sendJson } from "./http";
import type { BlindItem, BriefOption, Decision, Job, ModelOption, Quote, RunDetail, RunSummary, Setup, Verdict } from "./types";

const request = (path: string, body?: unknown): Promise<unknown> =>
  body === undefined ? getJson(path) : sendJson("POST", path, body);

export const api = {
  runs: async (): Promise<RunSummary[]> => runSummaries(await request("/api/runs")),
  run: async (id: string): Promise<RunDetail> => runDetail(await request(`/api/runs/${id}`)),
  briefs: async (): Promise<BriefOption[]> => briefOptions(await request("/api/briefs")),
  models: async (brief: string): Promise<ModelOption[]> =>
    modelOptions(await request(`/api/models?brief=${encodeURIComponent(brief)}`)),
  setup: async (): Promise<Setup> => setup(await request("/api/setup")),
  quote: async (brief: string, models: readonly string[], candidates: number): Promise<Quote> => {
    const query = new URLSearchParams({ brief, models: models.join(","), candidates: String(candidates) });
    return quote(await request(`/api/quote?${query.toString()}`));
  },
  startJob: async (brief: string, models: readonly string[], candidates: number): Promise<Job> =>
    job(await request("/api/jobs", { brief, models, candidates })),
  job: async (id: string): Promise<Job> => job(await request(`/api/jobs/${id}`)),
  decide: async (
    run: string,
    input: { candidate: string; verdict: Verdict; reviewer: string; note: string; override: boolean },
  ): Promise<Decision> => decision(await request(`/api/runs/${run}/decisions`, input)),
  validationSets: async (): Promise<string[]> => {
    const payload = await request("/api/validation");
    return Array.isArray(payload) ? (payload as unknown[]).filter((s) => typeof s === "string") : [];
  },
  blind: async (set: string): Promise<BlindItem[]> => blindItems(await request(`/api/validation/${set}`)),
  rate: async (set: string, id: string, verdict: Verdict, note: string): Promise<void> => {
    await request(`/api/validation/${set}/ratings`, { id, verdict, note });
  },
};

export const imageUrl = {
  candidate: (run: string, candidate: string): string => `/api/runs/${run}/candidates/${candidate}/image`,
  reference: (name: string): string => `/api/references/${name}`,
  blind: (set: string, id: string): string => `/api/validation/${set}/images/${id}`,
};
