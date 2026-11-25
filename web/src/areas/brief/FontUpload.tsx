import { useId, useRef, useState, type SyntheticEvent } from "react";
import { Field } from "../../components/Field";
import { ApiError } from "../../http";
import { FONT_ACCEPT, familyFromFileName, fontFileProblem } from "../../studio/fonts";
import { useWorkspace } from "../../workspace/context";

type Errors = Readonly<{ file?: string; family?: string; rights?: string; form?: string }>;

function validate(file: File | null, family: string, rights: boolean): Errors {
  return {
    ...(file === null ? { file: "Choose a font file." } : {}),
    ...(file !== null && fontFileProblem(file) !== null ? { file: fontFileProblem(file) ?? "" } : {}),
    ...(family.trim() === "" ? { family: "Name the font as it should appear in the list." } : {}),
    ...(rights ? {} : { rights: "Confirm that you may use this font in what you make." }),
  };
}

/** Upload a font file under a family name; it joins the lists of every brand in this studio. */
export function FontUpload() {
  const { addFont, brandDraft } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const fileNote = useId();
  const [file, setFile] = useState<File | null>(null);
  const [family, setFamily] = useState("");
  const [rights, setRights] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const choose = (next: File | undefined): void => {
    setAdded(null);
    setErrors({});
    setFile(next ?? null);
    if (next !== undefined && family.trim() === "") setFamily(familyFromFileName(next.name));
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const found = validate(file, family, rights);
    setErrors(found);
    if (file === null || Object.keys(found).length > 0) return;
    setBusy(true);
    addFont(file, family.trim())
      .then((font) => {
        setAdded(font.family);
        setFile(null);
        setFamily("");
        setRights(false);
      })
      .catch((failure: unknown) => {
        const fields = failure instanceof ApiError ? failure.fields : {};
        const message = failure instanceof Error ? failure.message : "Could not upload the font.";
        setErrors({ ...fields, ...(Object.keys(fields).length === 0 ? { form: message } : {}) });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const use = (role: "display" | "body"): void => {
    if (added === null) return;
    const { draft, edit } = brandDraft;
    edit({ ...draft, type: { ...draft.type, [role]: added } });
  };

  return (
    <details className="font-upload">
      <summary>Upload your own font</summary>
      <form className="font-upload-form" onSubmit={submit} noValidate>
        <p className="fine">
          A WOFF2, WOFF, TTF or OTF file, up to 10 MB. A variable font gives every weight; a single static file is used as it is. The
          file stays in this studio and is copied into the deliveries that use it.
        </p>
        <div className={errors.file === undefined ? "field" : "field field-bad"}>
          <button type="button" className="font-file" aria-describedby={fileNote} onClick={() => input.current?.click()}>
            {file === null ? "Choose a font file" : "Choose another file"}
          </button>
          <p id={fileNote} className={errors.file === undefined ? "field-hint" : "field-error"} role={errors.file === undefined ? undefined : "alert"}>
            {errors.file ?? file?.name ?? "No file chosen yet."}
          </p>
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={FONT_ACCEPT}
          aria-label="Font file"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Field label="Name in the font list" error={errors.family} hint="Letters, digits, spaces, dots, dashes or &.">
          {(control) => (
            <input
              {...control}
              value={family}
              maxLength={60}
              onChange={(e) => {
                setFamily(e.target.value);
              }}
            />
          )}
        </Field>
        <div className={errors.rights === undefined ? "check-field" : "check-field field-bad"}>
          <label className="inline">
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => {
                setRights(e.target.checked);
              }}
            />
            I have the licence to use this font in what I make, including the files I deliver
          </label>
          {errors.rights !== undefined && (
            <p className="field-error" role="alert">
              {errors.rights}
            </p>
          )}
        </div>
        {errors.form !== undefined && (
          <p role="alert" className="error">
            {errors.form}
          </p>
        )}
        <button type="submit" className="font-submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload font"}
        </button>
        {added !== null && (
          <div className="font-added" role="status">
            <p>{added} is in the font list now.</p>
            <button
              type="button"
              onClick={() => {
                use("display");
              }}
            >
              Use for headlines
            </button>
            <button
              type="button"
              onClick={() => {
                use("body");
              }}
            >
              Use for body text
            </button>
          </div>
        )}
      </form>
    </details>
  );
}
