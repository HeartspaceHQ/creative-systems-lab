import { useState } from "react";
import { useWorkspace } from "../workspace/context";
import { ColourSection } from "./brief/ColourSection";
import { DesignControls } from "./design/DesignControls";
import { ImagePicker } from "./design/ImagePicker";
import { PreviewPane } from "./design/PreviewPane";
import { previewScene } from "./design/scene";

const DEFAULT_FORMAT = "linkedin-portrait";

function Empty({ onImages }: { onImages: () => void }) {
  return (
    <div className="empty">
      <h2>Start with an approved image</h2>
      <p>The design is built around one image. Generate or import images, approve one, and it shows up here.</p>
      <button type="button" className="primary" onClick={onImages}>
        Go to Images
      </button>
    </div>
  );
}

export function DesignArea() {
  const { project, design, brandDraft, brand, fonts, formats, placeInDesign, goTo } = useWorkspace();
  const [chosenFormat, setFormat] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const approved = project.assets.filter((a) => a.status === "approved");
  const draft = design.draft;
  const asset = draft === null ? undefined : approved.find((a) => a.id === draft.asset);
  const format = chosenFormat ?? (formats.some((f) => f.key === DEFAULT_FORMAT) ? DEFAULT_FORMAT : (formats[0]?.key ?? DEFAULT_FORMAT));

  if (approved.length === 0) return <Empty onImages={() => { goTo("images"); }} />;
  if (draft === null || asset === undefined) {
    return (
      <div className="empty">
        <h2>Choose the image for this design</h2>
        <p>Pick one of your approved images to start.</p>
        <ImagePicker
          assets={approved}
          value={null}
          onChange={(id) => {
            placeInDesign(id).catch(() => {
              // The design is in the draft now, and its save status says why the server does not have it yet.
            });
          }}
        />
      </div>
    );
  }

  return (
    <div className="design-area">
      <PreviewPane
        scene={previewScene(brandDraft.draft, brand, draft, asset, format, fonts)}
        formats={formats}
        format={format}
        onFormat={setFormat}
        playing={playing}
        onPlaying={setPlaying}
      />
      <aside className="design-side" aria-label="Design controls">
        <DesignControls design={draft} asset={asset} approved={approved} errors={design.fieldErrors} onChange={design.edit} />
        <section className="design-brand" aria-label="Brand colours">
          <p className="fine">These are the colours of {brand.name}. A change here applies to every project that uses the brand.</p>
          <ColourSection />
        </section>
      </aside>
    </div>
  );
}
