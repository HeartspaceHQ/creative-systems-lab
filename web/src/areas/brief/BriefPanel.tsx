import { ChoiceGroup, type ChoiceOption } from "../../components/ChoiceGroup";
import { Field } from "../../components/Field";
import { Stepper } from "../../components/Stepper";
import type { Shape } from "../../studio/types";
import { useWorkspace } from "../../workspace/context";

const SHAPES: readonly ChoiceOption<Shape>[] = [
  { value: "square", label: "Square", hint: "1:1", visual: <span className="shape shape-square" /> },
  { value: "portrait", label: "Portrait", hint: "2:3", visual: <span className="shape shape-portrait" /> },
  { value: "landscape", label: "Landscape", hint: "3:2", visual: <span className="shape shape-landscape" /> },
];

const KINDS: readonly ChoiceOption<"photo" | "illustration">[] = [
  { value: "photo", label: "Photo", hint: "Looks like a photograph" },
  { value: "illustration", label: "Illustration", hint: "Drawn or graphic" },
];

const MAX_IMAGES = 8;

export function BriefPanel() {
  const { name, brief } = useWorkspace();
  const { draft, edit, fieldErrors } = brief;
  return (
    <section className="panel" aria-labelledby="brief-title">
      <h2 id="brief-title">Brief</h2>
      <Field label="Project name" error={name.draft.trim() === "" ? "Give the project a name." : name.fieldErrors["name"]}>
        {(props) => (
          <input
            {...props}
            type="text"
            value={name.draft}
            onChange={(e) => {
              name.edit(e.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label="What should the image show?"
        error={fieldErrors["subject"]}
        hint="Describe the scene, for example: a glass cup of tea in low morning light."
      >
        {(props) => (
          <textarea
            {...props}
            rows={4}
            value={draft.subject}
            onChange={(e) => {
              edit({ ...draft, subject: e.target.value });
            }}
          />
        )}
      </Field>
      <ChoiceGroup
        legend="Type of image"
        value={draft.kind}
        options={KINDS}
        error={fieldErrors["kind"]}
        onChange={(kind) => {
          edit({ ...draft, kind });
        }}
      />
      <ChoiceGroup
        legend="Shape"
        value={draft.shape}
        options={SHAPES}
        error={fieldErrors["shape"]}
        onChange={(shape) => {
          edit({ ...draft, shape });
        }}
      />
      <Stepper
        label="Images per model"
        value={draft.candidates}
        min={1}
        max={MAX_IMAGES}
        error={fieldErrors["candidates"]}
        hint="Each model you choose in Images makes this many to pick from."
        onChange={(candidates) => {
          edit({ ...draft, candidates });
        }}
      />
    </section>
  );
}
