/**
 * How a variant, a format and a photograph become the data one scene is built from. Pure: no Node,
 * so the renderer, the web export and the studio's live preview share it.
 */
import type { AssetManifest, Campaign, Composition, Copy, Format, Layer, SceneData, Tokens, Variant } from "./types.ts";

/** A variant resolved against its campaign: what every medium of it shares. */
export interface Resolved {
  readonly variant: Variant;
  readonly layer: Layer;
  readonly copy: Copy;
  readonly lengthS: number;
  readonly composition: Composition;
}

/** The one place a variant's layer, copy, length and composition are merged over the campaign's. */
export function resolveVariant(tokens: Tokens, campaign: Campaign, variant: Variant): Resolved {
  const layer = tokens.layers[variant.layer];
  if (layer === undefined) throw new Error(`variant ${variant.id} names unknown layer ${variant.layer}`);
  return {
    variant,
    layer,
    copy: { ...campaign.copy, ...variant.copy },
    lengthS: campaign.length_s ?? tokens.motion.length_s,
    composition: { ...campaign.composition, ...variant.composition },
  };
}

export function sceneData(tokens: Tokens, campaign: Campaign, asset: AssetManifest, variant: Variant, format: Format): SceneData {
  const { layer, copy, lengthS, composition } = resolveVariant(tokens, campaign, variant);
  return {
    lengthS, tokens, layer, copy, brand: campaign.brand, format, imageUrl: asset.path, focus: asset.focus, composition,
    ...(asset.light === undefined ? {} : { light: asset.light }),
    ...(asset.alt === undefined ? {} : { alt: asset.alt }),
  };
}
