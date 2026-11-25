import type { Format } from "../../studio/types";
import { FormatSwitcher } from "./FormatSwitcher";
import { overflowSentence } from "./scene";
import { usePreview, type PreviewScene } from "./preview";

interface Props {
  readonly scene: PreviewScene;
  readonly formats: readonly Format[];
  readonly format: string;
  readonly onFormat: (key: string) => void;
  readonly playing: boolean;
  readonly onPlaying: (playing: boolean) => void;
}

export function PreviewPane({ scene, formats, format, onFormat, playing, onPlaying }: Props) {
  const { frame, status, url } = usePreview(scene, playing);
  const overflow = status.state === "ready" ? overflowSentence(status.overflow) : null;
  return (
    <section className="preview" aria-label="Preview">
      <div className="preview-bar">
        <FormatSwitcher formats={formats} value={format} onChange={onFormat} />
        <button
          type="button"
          aria-pressed={playing}
          onClick={() => {
            onPlaying(!playing);
          }}
        >
          {playing ? "Stop motion" : "Play motion"}
        </button>
      </div>
      <div className="preview-stage">
        <iframe ref={frame} src={url} title="Live preview of your design" />
        {status.state === "loading" && <p className="preview-note">Drawing the preview…</p>}
      </div>
      <div className="preview-messages" aria-live="polite">
        {overflow !== null && <p className="note warn">{overflow}</p>}
        {status.state === "error" && (
          <p className="error" role="alert">
            {status.message}
          </p>
        )}
        {status.state === "ready" && overflow === null && !playing && (
          <p className="fine">Showing the finished frame. Play motion to see it move.</p>
        )}
      </div>
    </section>
  );
}
