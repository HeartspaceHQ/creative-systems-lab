import { Field } from "../../components/Field";
import { useWorkspace } from "../../workspace/context";
import { ColourSection } from "./ColourSection";
import { ReferencesSection } from "./ReferencesSection";
import { TypeSection } from "./TypeSection";

export function BrandEditor() {
  const { brandDraft } = useWorkspace();
  const { draft, edit, fieldErrors } = brandDraft;
  return (
    <div className="brand-editor">
      <Field label="Brand name" error={draft.name.trim() === "" ? "Give the brand a name." : fieldErrors["name"]}>
        {(props) => (
          <input
            {...props}
            type="text"
            value={draft.name}
            onChange={(e) => {
              edit({ ...draft, name: e.target.value });
            }}
          />
        )}
      </Field>
      <ColourSection />
      <TypeSection />
      <Field label="Style note" hint="A sentence or two on the look and feel, for example: warm natural light, calm, editorial.">
        {(props) => (
          <textarea
            {...props}
            rows={3}
            value={draft.styleNote}
            onChange={(e) => {
              edit({ ...draft, styleNote: e.target.value });
            }}
          />
        )}
      </Field>
      <ReferencesSection />
    </div>
  );
}
