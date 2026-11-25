import type { Format } from "../../studio/types";

interface Props {
  readonly formats: readonly Format[];
  readonly value: string;
  readonly onChange: (key: string) => void;
}

const LONG_SIDE = 22;

/** The shape of a format, drawn at a small fixed size so the choices can be compared at a glance. */
export function AspectShape({ format }: { format: Format }) {
  const long = Math.max(format.width, format.height);
  return (
    <span
      className="aspect-shape"
      aria-hidden="true"
      style={{ width: (format.width / long) * LONG_SIDE, height: (format.height / long) * LONG_SIDE }}
    />
  );
}

export function FormatSwitcher({ formats, value, onChange }: Props) {
  return (
    <div className="format-switcher" role="group" aria-label="Preview size">
      {formats.map((format) => (
        <button
          key={format.key}
          type="button"
          className="format-button"
          aria-pressed={format.key === value}
          onClick={() => {
            onChange(format.key);
          }}
        >
          <AspectShape format={format} />
          <span>{format.label}</span>
        </button>
      ))}
    </div>
  );
}
