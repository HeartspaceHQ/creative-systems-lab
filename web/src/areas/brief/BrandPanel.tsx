import { useState } from "react";
import { Field } from "../../components/Field";
import { useWorkspace } from "../../workspace/context";
import { BrandEditor } from "./BrandEditor";

function BrandChooser() {
  const { brand, brands, chooseBrand, createBrand } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const create = (): void => {
    if (name.trim() === "") {
      setError("Give the new brand a name.");
      return;
    }
    createBrand(name.trim())
      .then((created) => chooseBrand(created.id))
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : "Could not create the brand.");
      });
  };

  return (
    <div className="brand-chooser">
      <Field label="Brand for this project">
        {(props) => (
          <select
            {...props}
            value={brand.id}
            onChange={(e) => {
              void chooseBrand(e.target.value);
            }}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {creating ? (
        <div className="inline-form">
          <Field label="New brand name" error={error}>
            {(props) => (
              <input
                {...props}
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(undefined);
                }}
              />
            )}
          </Field>
          <div className="actions">
            <button type="button" className="primary" onClick={create}>
              Create brand
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setCreating(true);
          }}
        >
          Create a new brand
        </button>
      )}
    </div>
  );
}

export function BrandPanel() {
  return (
    <section className="panel" aria-labelledby="brand-title">
      <h2 id="brand-title">Brand</h2>
      <BrandChooser />
      <p className="fine">Changes to a brand apply to every project that uses it.</p>
      <BrandEditor />
    </section>
  );
}
