import { Field } from "../../components/Field";
import type { Copy } from "../../studio/types";

interface Props {
  readonly copy: Copy;
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (copy: Copy) => void;
}

export function CopyFields({ copy, errors, onChange }: Props) {
  const set = (key: keyof Copy) => (value: string) => {
    onChange({ ...copy, [key]: value });
  };
  const headlineHint = copy.headline.trim() === "" ? "Write a headline to save this design. Press Enter for a new line." : "Press Enter for a new line.";
  return (
    <div className="copy-fields">
      <Field label="Label" error={errors["copy.label"]} hint="A short line above the headline">
        {(props) => <input {...props} type="text" value={copy.label} onChange={(e) => { set("label")(e.target.value); }} />}
      </Field>
      <Field label="Headline" error={errors["copy.headline"]} hint={headlineHint}>
        {(props) => <textarea {...props} rows={3} value={copy.headline} onChange={(e) => { set("headline")(e.target.value); }} />}
      </Field>
      <Field label="Body" error={errors["copy.body"]}>
        {(props) => <textarea {...props} rows={3} value={copy.body} onChange={(e) => { set("body")(e.target.value); }} />}
      </Field>
      <div className="two-fields">
        <Field label="Call to action" error={errors["copy.cta"]}>
          {(props) => <input {...props} type="text" value={copy.cta} onChange={(e) => { set("cta")(e.target.value); }} />}
        </Field>
        <Field label="Sender" error={errors["copy.sender"]}>
          {(props) => <input {...props} type="text" value={copy.sender} onChange={(e) => { set("sender")(e.target.value); }} />}
        </Field>
      </div>
    </div>
  );
}
