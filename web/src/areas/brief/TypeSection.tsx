import { Field } from "../../components/Field";
import { FONT_GROUPS, fontStack } from "../../studio/fonts";
import type { FontOption } from "../../studio/types";
import { useWorkspace } from "../../workspace/context";
import { FontUpload } from "./FontUpload";

function FontSelect(props: {
  label: string;
  value: string;
  fonts: readonly FontOption[];
  error?: string | undefined;
  onChange: (family: string) => void;
}) {
  const { label, value, fonts, error, onChange } = props;
  const missing = !fonts.some((font) => font.family === value);
  return (
    <Field label={label} error={error}>
      {(control) => (
        <select
          {...control}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          {missing && <option value={value}>{value}</option>}
          {FONT_GROUPS.map(({ kind, label: groupLabel }) => {
            const members = fonts.filter((font) => font.kind === kind);
            return (
              members.length > 0 && (
                <optgroup key={kind} label={groupLabel}>
                  {members.map((font) => (
                    <option key={font.family} value={font.family}>
                      {font.family}
                    </option>
                  ))}
                </optgroup>
              )
            );
          })}
        </select>
      )}
    </Field>
  );
}

export function TypeSection() {
  const { brandDraft, fonts } = useWorkspace();
  const { draft, edit, fieldErrors } = brandDraft;
  const { ground, text, quiet, accent } = draft.colours;
  return (
    <fieldset className="type-set">
      <legend>Typography</legend>
      <div className="type-pickers">
        <FontSelect
          label="Headlines"
          value={draft.type.display}
          fonts={fonts}
          error={fieldErrors["type.display"]}
          onChange={(display) => {
            edit({ ...draft, type: { ...draft.type, display } });
          }}
        />
        <FontSelect
          label="Body text"
          value={draft.type.body}
          fonts={fonts}
          error={fieldErrors["type.body"]}
          onChange={(body) => {
            edit({ ...draft, type: { ...draft.type, body } });
          }}
        />
      </div>
      <div className="type-sample" style={{ background: ground, color: text }} aria-label="Type sample">
        <p className="sample-display" style={{ fontFamily: fontStack(draft.type.display) }}>
          {draft.name.trim() === "" ? "Your brand" : draft.name}
        </p>
        <p className="sample-body" style={{ fontFamily: fontStack(draft.type.body), color: quiet }}>
          Body text sets the tone for everything people read. The quick brown fox jumps over the lazy dog, 0123456789.
        </p>
        <p className="sample-accent" style={{ fontFamily: fontStack(draft.type.body), color: accent }}>
          Call to action
        </p>
      </div>
      <FontUpload />
    </fieldset>
  );
}
