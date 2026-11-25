import type { ReactNode } from "react";

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  readonly visual?: ReactNode;
}

interface Props<T extends string> {
  readonly legend: string;
  readonly value: T;
  readonly options: readonly ChoiceOption<T>[];
  readonly onChange: (value: T) => void;
  readonly error?: string | undefined;
  readonly compact?: boolean;
}

/** Radio buttons drawn as cards, so a choice can show what it means. Keyboard behaviour is the browser's own. */
export function ChoiceGroup<T extends string>(props: Props<T>) {
  const { legend, value, options, onChange, error, compact = false } = props;
  const name = `choice-${legend.replaceAll(/\W+/g, "-").toLowerCase()}`;
  return (
    <fieldset className={error === undefined ? "choices" : "choices field-bad"}>
      <legend>{legend}</legend>
      <div className={compact ? "choice-row choice-compact" : "choice-row"}>
        {options.map((option) => (
          <label key={option.value} className="choice">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
            />
            {option.visual !== undefined && <span className="choice-visual">{option.visual}</span>}
            <span className="choice-label">{option.label}</span>
            {option.hint !== undefined && <span className="choice-hint">{option.hint}</span>}
          </label>
        ))}
      </div>
      {error !== undefined && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
