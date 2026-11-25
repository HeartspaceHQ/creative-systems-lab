/** Plain-language names, prices and reasons for the models, so the main flow never shows registry text. */
import { usd } from "../format";
import type { ModelOption, ProviderStatus } from "../types";

const NAMES: Readonly<Record<string, string>> = {
  "flux2-klein-4b-q8": "FLUX.2 Klein 4B, best quality",
  "flux2-klein-4b-q4": "FLUX.2 Klein 4B, faster",
  "flux2-klein-9b-q6": "FLUX.2 Klein 9B",
  procedural: "Built-in shape drawing",
  "procedural-offbrand": "Colour check test (wrong palette on purpose)",
  "gpt-image-2.6-sunburst": "OpenAI GPT Image, detailed",
  "gpt-image-2.6-flare": "OpenAI GPT Image, fast",
  "nano-banana-2.1": "Google Nano Banana 2.1",
  "nano-banana-pro": "Google Nano Banana Pro",
  "grok-imagine-image-2.0": "xAI Grok Imagine",
  "flux-2-pro": "Black Forest Labs FLUX.2 pro",
  "flux-3-image": "Black Forest Labs FLUX 3",
  "elevenlabs-nano-banana-pro": "Nano Banana Pro through ElevenLabs",
  "elevenlabs-gpt-image-2.5-sunburst": "GPT Image through ElevenLabs",
};

const BLURBS: Readonly<Record<string, string>> = {
  procedural: "Draws simple flat shapes in your brand colours. Illustrations only, and a quick way to try the flow.",
};

/** Models that exist to test the checks, not to make images for a project. */
export const isTestModel = (model: ModelOption): boolean => model.key.endsWith("-offbrand");

export function modelName(key: string, fallback: string): string {
  const known = NAMES[key];
  if (known !== undefined) return known;
  return fallback.replace(/\s*\(.*\)\s*$/, "").split(", ")[0] ?? fallback;
}

export const modelBlurb = (key: string): string | null => BLURBS[key] ?? null;

export function priceText(model: ModelOption): string {
  if (model.location === "local") return "Free, runs on this computer";
  if (model.perImageUsd === null) return "Paid";
  return `Paid, about ${usd(model.perImageUsd)} per image${model.priceConfirmed ? "" : " (estimate)"}`;
}

export interface Blocked {
  readonly text: string;
  /** The provider whose key would unlock the model. */
  readonly provider: ProviderStatus | null;
}

/** Why a model cannot be used, in plain words and with the way out, or null when it can be used. */
export function blockedBy(model: ModelOption, providers: readonly ProviderStatus[]): Blocked | null {
  const own = model.excludedReason !== null && model.excludedReason !== model.unavailableReason;
  const reason = own ? model.excludedReason : model.unavailableReason;
  if (reason === null) return model.available ? null : { text: "Not available right now.", provider: null };
  const provider = providers.find((p) => p.models.includes(model.key) && !p.set) ?? null;
  if (/API_KEY is not set|key is not set|not set/i.test(reason)) {
    return { text: provider === null ? "Needs an API key." : `Connect ${provider.name} to use it.`, provider };
  }
  if (reason.includes("budget")) {
    return { text: "Set a spending limit under Budget to use paid models.", provider: null };
  }
  if (reason.includes("mflux") || reason.includes("Hugging Face cache")) {
    return { text: "Not installed on this computer yet.", provider: null };
  }
  if (reason.startsWith("does not support kind")) {
    return { text: "Cannot make this type of image.", provider: null };
  }
  if (reason.includes("commercial use")) {
    return { text: "Its licence does not allow commercial use.", provider: null };
  }
  return { text: reason, provider: null };
}
