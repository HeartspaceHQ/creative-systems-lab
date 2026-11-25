import type { Format } from "../../studio/types";
import { AspectShape } from "../design/FormatSwitcher";

interface Props {
  readonly formats: readonly Format[];
  readonly chosen: readonly string[];
  readonly error: string | undefined;
  readonly onToggle: (key: string) => void;
}

export function FormatPicker({ formats, chosen, error, onToggle }: Props) {
  return (
    <fieldset className={error === undefined ? "format-picker" : "format-picker field-bad"}>
      <legend>Sizes</legend>
      <ul className="format-list">
        {formats.map((format) => (
          <li key={format.key}>
            <label className="format-option">
              <input type="checkbox" checked={chosen.includes(format.key)} onChange={() => { onToggle(format.key); }} />
              <AspectShape format={format} />
              <span className="format-name">{format.label}</span>
              <span className="fine num">
                {String(format.width)} × {String(format.height)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error !== undefined && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

