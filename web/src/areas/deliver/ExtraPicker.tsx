import type { Extra } from "../../studio/types";

interface Props {
  readonly chosen: readonly Extra[];
  readonly firstSize: string | null;
  readonly error: string | undefined;
  readonly onToggle: (extra: Extra) => void;
}

const EXTRAS: readonly { key: Extra; label: string; text: string }[] = [
  { key: "mp4", label: "Film (MP4)", text: "The design moving, as a video for LinkedIn or the web." },
  { key: "gif", label: "Animation (GIF)", text: "A short looping animation that plays anywhere, without sound." },
  { key: "pdf", label: "Print file (PDF)", text: "The finished frame on one page, for print or for sharing." },
];

export function ExtraPicker({ chosen, firstSize, error, onToggle }: Props) {
  return (
    <fieldset className={error === undefined ? "extras" : "extras field-bad"}>
      <legend>Extras</legend>
      <ul className="extra-list">
        {EXTRAS.map((extra) => (
          <li key={extra.key}>
            <label className="extra-option">
              <input type="checkbox" checked={chosen.includes(extra.key)} onChange={() => { onToggle(extra.key); }} />
              <span className="extra-name">{extra.label}</span>
              <span className="fine">{extra.text}</span>
            </label>
          </li>
        ))}
      </ul>
      {chosen.length > 0 && firstSize !== null && <p className="fine">Extras use the size you picked first: {firstSize}.</p>}
      {error !== undefined && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
