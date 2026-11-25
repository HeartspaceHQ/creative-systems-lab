import { useId, type ReactNode } from "react";

export interface ControlProps {
  readonly id: string;
  readonly "aria-describedby": string;
  readonly "aria-invalid": boolean;
}

interface Props {
  readonly label: string;
  /** The sentence shown right under the control when the value is not acceptable. */
  readonly error?: string | undefined;
  readonly hint?: string;
  readonly children: (control: ControlProps) => ReactNode;
}

/** A labelled control whose problem is stated beside it, in words, and announced to screen readers. */
export function Field({ label, error, hint, children }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={error === undefined ? "field" : "field field-bad"}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": noteId, "aria-invalid": error !== undefined })}
      <p id={noteId} className={error === undefined ? "field-hint" : "field-error"} role={error === undefined ? undefined : "alert"}>
        {error ?? hint}
      </p>
    </div>
  );
}
