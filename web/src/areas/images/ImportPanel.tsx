import { useRef, useState, type DragEvent } from "react";
import { studioApi } from "../../studio/api";
import { ACCEPT_ATTRIBUTE, imageProblem } from "../../studio/files";
import type { Asset } from "../../studio/types";
import { useWorkspace } from "../../workspace/context";

interface Props {
  readonly onImported: (asset: Asset) => void;
}

export function ImportPanel({ onImported }: Props) {
  const { project, refresh } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);

  const upload = async (files: readonly File[]): Promise<void> => {
    const found: string[] = [];
    let last: Asset | null = null;
    for (const file of files) {
      const problem = imageProblem(file);
      if (problem !== null) {
        found.push(problem);
        continue;
      }
      setBusy(file.name);
      try {
        last = await studioApi.importImage(project.id, file);
      } catch (failure) {
        found.push(`${file.name}: ${failure instanceof Error ? failure.message : "could not be imported."}`);
      }
    }
    setBusy(null);
    setProblems(found);
    if (last !== null) {
      await refresh();
      onImported(last);
    }
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setOver(false);
    void upload([...event.dataTransfer.files]);
  };

  return (
    <div className="import">
      <h2>Import images</h2>
      <p className="fine">
        Bring in a photo or illustration you already have. It needs your OK before it can go into a design, and you
        confirm there that you have the right to use it.
      </p>
      <div
        className={over ? "dropzone dropzone-over" : "dropzone"}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={onDrop}
      >
        <p>{busy === null ? "Drop images here" : `Importing ${busy}…`}</p>
        <button type="button" className="primary" disabled={busy !== null} onClick={() => input.current?.click()}>
          Choose files
        </button>
        <p className="fine">PNG, JPEG or WebP, up to 25 MB each.</p>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept={ACCEPT_ATTRIBUTE}
          aria-label="Choose images to import"
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      {problems.length > 0 && (
        <ul className="problems" role="alert">
          {problems.map((problem) => (
            <li key={problem} className="field-error">
              {problem}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
