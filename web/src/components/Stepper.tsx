interface Props {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly hint?: string;
  readonly error?: string | undefined;
}

export function Stepper({ label, value, min, max, onChange, hint, error }: Props) {
  return (
    <div className={error === undefined ? "field" : "field field-bad"}>
      <span className="field-label" id={`stepper-${label}`}>
        {label}
      </span>
      <div className="stepper" role="group" aria-labelledby={`stepper-${label}`}>
        <button
          type="button"
          aria-label="One fewer"
          disabled={value <= min}
          onClick={() => {
            onChange(value - 1);
          }}
        >
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button
          type="button"
          aria-label="One more"
          disabled={value >= max}
          onClick={() => {
            onChange(value + 1);
          }}
        >
          +
        </button>
      </div>
      <p className={error === undefined ? "field-hint" : "field-error"}>{error ?? hint}</p>
    </div>
  );
}
