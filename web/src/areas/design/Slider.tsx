import { useId } from "react";

interface Props {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly onChange: (value: number) => void;
}

export function Slider({ label, value, min, max, step, format, hint, error, onChange }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={error === undefined ? "field slider" : "field slider field-bad"}>
      <label htmlFor={id}>
        {label} <output className="num" htmlFor={id}>{format(value)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-describedby={noteId}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
      />
      <p id={noteId} className={error === undefined ? "field-hint" : "field-error"} role={error === undefined ? undefined : "alert"}>
        {error ?? hint}
      </p>
    </div>
  );
}
