import type { Asset, Design } from "../../studio/types";
import { CopyFields } from "./CopyFields";
import { FocusPicker } from "./FocusPicker";
import { ImagePicker } from "./ImagePicker";
import { LayoutChoice } from "./LayoutChoice";
import { Slider } from "./Slider";

interface Props {
  readonly design: Design;
  readonly asset: Asset;
  readonly approved: readonly Asset[];
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (design: Design) => void;
}

/**
 * The crop each image had the last time it was in the design, so trying another image and coming back
 * does not lose the framing. Kept for this browser session; the saved design holds the current image's.
 */
const cropOf = new Map<string, Pick<Design, "focus" | "zoom">>();

const times = (value: number): string => `${value.toFixed(2).replace(/\.?0+$/, "")}×`;
const percent = (value: number): string => `${String(Math.round(value * 100))}%`;

export function DesignControls({ design, asset, approved, errors, onChange }: Props) {
  return (
    <div className="design-controls">
      <ImagePicker
        assets={approved}
        value={design.asset}
        onChange={(id) => {
          if (id === design.asset) return;
          cropOf.set(design.asset, { focus: design.focus, zoom: design.zoom });
          onChange({ ...design, asset: id, ...(cropOf.get(id) ?? { focus: { x: 0.5, y: 0.5 }, zoom: 1 }) });
        }}
      />
      <fieldset className="crop">
        <legend>Crop</legend>
        <p className="fine">Drag the dot to the part of the picture that must stay in view.</p>
        <FocusPicker
          asset={asset}
          focus={design.focus}
          onChange={(focus) => {
            onChange({ ...design, focus });
          }}
        />
        <Slider
          label="Zoom"
          value={design.zoom}
          min={1}
          max={2}
          step={0.05}
          format={times}
          error={errors["zoom"]}
          onChange={(zoom) => {
            onChange({ ...design, zoom });
          }}
        />
      </fieldset>
      <LayoutChoice
        value={design.layout}
        onChange={(layout) => {
          onChange({ ...design, layout });
        }}
      />
      <CopyFields
        copy={design.copy}
        errors={errors}
        onChange={(copy) => {
          onChange({ ...design, copy });
        }}
      />
      <Slider
        label="Headline size"
        value={design.headlineScale}
        min={0.5}
        max={2}
        step={0.05}
        format={percent}
        error={errors["headline_scale"]}
        onChange={(headlineScale) => {
          onChange({ ...design, headlineScale });
        }}
      />
      {design.layout === "cinema" && (
        <Slider
          label="Darkness at start"
          value={design.night}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          hint="How dark the picture is when the film begins. Play motion to see it."
          error={errors["night"]}
          onChange={(night) => {
            onChange({ ...design, night });
          }}
        />
      )}
    </div>
  );
}
