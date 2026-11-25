import { useId, useState } from "react";
import { MIN_CONTRAST, contrast, normaliseHex } from "../../studio/colour";

interface Props {
  readonly label: string;
  readonly description: string;
  readonly value: string;
  /** Called only with a valid `#rrggbb`. */
  readonly onChange: (hex: string) => void;
  /** The background this colour is read on; when given, low contrast is called out here. */
  readonly ground?: string;
  readonly serverError?: string | undefined;
}

function warning(label: string, value: string, ground: string | undefined): string | null {
  const hex = normaliseHex(value);
  const base = ground === undefined ? null : normaliseHex(ground);
  if (hex === null || base === null) return null;
  const ratio = contrast(hex, base);
  if (ratio >= MIN_CONTRAST) return null;
  return `${label} is hard to read on this background (${ratio.toFixed(1)} to 1). Aim for at least ${MIN_CONTRAST.toFixed(1)} to 1: make it darker, or the background lighter.`;
}

/** A native colour picker and a hex field that always agree. Only a valid hex reaches the brand. */
export function ColourField({ label, description, value, onChange, ground, serverError }: Props) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? value;
  const parsed = normaliseHex(shown);
  const formatError = parsed === null ? "Use a colour like #1d2a3a." : undefined;
  const problem = formatError ?? serverError ?? warning(label, value, ground) ?? undefined;
  const isWarning = formatError === undefined && serverError === undefined && problem !== undefined;
  return (
    <div className={problem === undefined ? "colour-field" : isWarning ? "colour-field field-warn" : "colour-field field-bad"}>
      <div className="colour-head">
        <label htmlFor={`${id}-hex`}>{label}</label>
        <span className="fine">{description}</span>
      </div>
      <div className="colour-inputs">
        <input
          type="color"
          aria-label={`${label}, colour picker`}
          value={parsed ?? normaliseHex(value) ?? "#000000"}
          onChange={(e) => {
            setTyped(null);
            onChange(e.target.value);
          }}
        />
        <input
          id={`${id}-hex`}
          type="text"
          className="hex"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          value={shown}
          aria-invalid={formatError !== undefined}
          aria-describedby={`${id}-note`}
          onChange={(e) => {
            setTyped(e.target.value);
            const hex = normaliseHex(e.target.value);
            if (hex !== null) onChange(hex);
          }}
          onBlur={() => {
            if (normaliseHex(shown) !== null) setTyped(null);
          }}
        />
      </div>
      <p
        id={`${id}-note`}
        className={isWarning ? "field-warning" : "field-error"}
        role={problem === undefined || isWarning ? undefined : "alert"}
      >
        {problem}
      </p>
    </div>
  );
}
