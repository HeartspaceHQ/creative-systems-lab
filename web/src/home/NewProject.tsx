import { useState, type SyntheticEvent } from "react";
import { ApiError } from "../http";
import { go, projectHref } from "../route";
import { studioApi } from "../studio/api";
import { newBrandDraft } from "../studio/defaults";
import type { Brand } from "../studio/types";
import { Field } from "../components/Field";

const NEW_BRAND = "__new__";

interface Props {
  readonly brands: readonly Brand[];
  readonly fonts: readonly string[];
  readonly onCancel: (() => void) | null;
}

type Errors = Readonly<{ name?: string; brand?: string; brandName?: string; form?: string }>;

async function createBrandIfNeeded(choice: string, brandName: string, fonts: readonly string[]): Promise<string> {
  if (choice !== NEW_BRAND) return choice;
  return (await studioApi.createBrand(newBrandDraft(brandName.trim(), fonts))).id;
}

function validate(name: string, choice: string, brandName: string): Errors {
  return {
    ...(name.trim() === "" ? { name: "Give the project a name, for example “Winter campaign”." } : {}),
    ...(choice === "" ? { brand: "Choose a brand, or create a new one." } : {}),
    ...(choice === NEW_BRAND && brandName.trim() === "" ? { brandName: "Give the new brand a name." } : {}),
  };
}

export function NewProject({ brands, fonts, onCancel }: Props) {
  const [name, setName] = useState("");
  const [choice, setChoice] = useState(brands.length === 1 ? (brands[0]?.id ?? "") : brands.length === 0 ? NEW_BRAND : "");
  const [brandName, setBrandName] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const found = validate(name, choice, brandName);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    createBrandIfNeeded(choice, brandName, fonts)
      .then((brandId) => studioApi.createProject(name.trim(), brandId))
      .then((project) => {
        go(projectHref(project.id, "brief"));
      })
      .catch((failure: unknown) => {
        const fields = failure instanceof ApiError ? failure.fields : {};
        setErrors({
          ...(fields["name"] ? { name: fields["name"] } : {}),
          form: failure instanceof Error ? failure.message : "Could not create the project.",
        });
        setBusy(false);
      });
  };

  return (
    <form className="panel new-project" onSubmit={submit} noValidate aria-labelledby="new-project-title">
      <h2 id="new-project-title">New project</h2>
      <Field label="Project name" error={errors.name}>
        {(props) => (
          <input
            {...props}
            type="text"
            value={name}
            placeholder="Winter campaign"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        )}
      </Field>
      <Field label="Brand" error={errors.brand} hint="Colours, fonts and references. Reuse one you already made, or start a new one.">
        {(props) => (
          <select
            {...props}
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
            }}
          >
            <option value="" disabled>
              Choose a brand
            </option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value={NEW_BRAND}>Create a new brand…</option>
          </select>
        )}
      </Field>
      {choice === NEW_BRAND && (
        <Field label="New brand name" error={errors.brandName} hint="You set its colours and fonts in the next step.">
          {(props) => (
            <input
              {...props}
              type="text"
              value={brandName}
              onChange={(e) => {
                setBrandName(e.target.value);
              }}
            />
          )}
        </Field>
      )}
      {errors.form !== undefined && (
        <p role="alert" className="error">
          {errors.form}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </button>
        {onCancel !== null && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
