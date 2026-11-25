import { useRef, useState, type DragEvent } from "react";
import { ACCEPT_ATTRIBUTE, imageProblem } from "../../studio/files";
import { studioApi } from "../../studio/api";
import { useWorkspace } from "../../workspace/context";

export function ReferencesSection() {
  const { brand, applyBrand } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (files: readonly File[]): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      for (const file of files) {
        const problem = imageProblem(file);
        if (problem !== null) {
          setError(problem);
          continue;
        }
        applyBrand(await studioApi.addReference(brand.id, file));
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not add the image.");
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string): void => {
    studioApi.removeReference(brand.id, id).then(applyBrand, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : "Could not remove the image.");
    });
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    void add([...event.dataTransfer.files]);
  };

  return (
    <fieldset className="refs">
      <legend>Visual references</legend>
      <p className="fine">Images that show the look you want. They help judge whether new images belong to the brand.</p>
      <ul className="ref-grid">
        {brand.references.map((reference) => (
          <li key={reference.id}>
            <img src={reference.url} alt={reference.name} loading="lazy" />
            <button
              type="button"
              className="ref-remove"
              aria-label={`Remove ${reference.name}`}
              onClick={() => {
                remove(reference.id);
              }}
            >
              Remove
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="ref-add"
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={onDrop}
          >
            {busy ? "Adding…" : "Add images"}
          </button>
        </li>
      </ul>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={ACCEPT_ATTRIBUTE}
        aria-label="Add reference images"
        onChange={(e) => {
          void add([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {error !== null && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
