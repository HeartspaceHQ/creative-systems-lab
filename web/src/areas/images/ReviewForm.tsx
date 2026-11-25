import { useState } from "react";
import { api } from "../../api";
import { Field } from "../../components/Field";
import { ApiError } from "../../http";
import { studioApi } from "../../studio/api";
import { useReviewer } from "../../studio/reviewer";
import type { Verdict } from "../../types";
import { useWorkspace } from "../../workspace/context";
import type { LibraryItem } from "./items";

interface Props {
  readonly item: LibraryItem;
  /** Called with the key of the item to show next and the verdict, once the decision is recorded. */
  readonly onDecided: (nextKey: string, verdict: Verdict) => void;
}

type Errors = Readonly<{ reviewer?: string; note?: string; rights?: string; override?: string; form?: string }>;

const isImport = (item: LibraryItem): boolean => item.asset?.origin === "imported";
const needsOverride = (item: LibraryItem): boolean => item.asset === null && item.flagged;

function problems(item: LibraryItem, verdict: Verdict, input: { reviewer: string; note: string; rights: boolean; override: boolean }): Errors {
  const approving = verdict === "approve";
  return {
    ...(input.reviewer.trim() === "" ? { reviewer: "Add your name so the decision is recorded." } : {}),
    ...(approving && isImport(item) && !input.rights ? { rights: "Confirm that you have the right to use this image." } : {}),
    ...(approving && needsOverride(item) && !input.override
      ? { override: "The automatic checks flagged this image. Tick this box if you have looked at it and still want it." }
      : {}),
    ...(approving && needsOverride(item) && input.override && input.note.trim() === ""
      ? { note: "Add a short comment on why this image is fine, since the checks flagged it." }
      : {}),
  };
}

function fromServer(error: unknown): Errors {
  const fields = error instanceof ApiError ? error.fields : {};
  return {
    ...(fields["reviewer"] ? { reviewer: fields["reviewer"] } : {}),
    ...(fields["note"] ? { note: fields["note"] } : {}),
    ...(fields["rights_confirmed"] ? { rights: fields["rights_confirmed"] } : {}),
    form: error instanceof Error ? error.message : "The decision could not be saved.",
  };
}

export function ReviewForm({ item, onDecided }: Props) {
  const { project, refresh } = useWorkspace();
  const reviewer = useReviewer();
  const [note, setNote] = useState("");
  const [rights, setRights] = useState(false);
  const [override, setOverride] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const record = async (verdict: Verdict): Promise<string> => {
    const { asset, origin } = item;
    if (asset !== null) {
      await studioApi.decideAsset(project.id, asset.id, {
        verdict,
        reviewer: reviewer.name.trim(),
        note,
        rightsConfirmed: rights,
      });
      return item.key;
    }
    if (origin === null) throw new Error("This image has no record to decide on.");
    await api.decide(origin.run.id, {
      candidate: origin.candidate.id,
      verdict,
      reviewer: reviewer.name.trim(),
      note,
      override,
    });
    if (verdict === "reject") return item.key;
    const created = await studioApi.assetFromRun(project.id, origin.run.id, origin.candidate.id);
    return `asset:${created.id}`;
  };

  const submit = (verdict: Verdict): void => {
    const found = problems(item, verdict, { reviewer: reviewer.name, note, rights, override });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    record(verdict)
      .then(async (nextKey) => {
        reviewer.remember();
        setNote("");
        await refresh();
        onDecided(nextKey, verdict);
      })
      .catch((failure: unknown) => {
        setErrors(fromServer(failure));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form
      className="review-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <Field label="Your name" error={errors.reviewer}>
        {(props) => (
          <input
            {...props}
            type="text"
            autoComplete="name"
            value={reviewer.name}
            onChange={(e) => {
              reviewer.setName(e.target.value);
            }}
          />
        )}
      </Field>
      {needsOverride(item) && (
        <div className={errors.override === undefined ? "check-field" : "check-field field-bad"}>
          <label className="inline">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => {
                setOverride(e.target.checked);
              }}
            />
            Approve anyway, I have looked at this image
          </label>
          {errors.override !== undefined && <p className="field-error" role="alert">{errors.override}</p>}
        </div>
      )}
      <Field label="Comment (optional)" error={errors.note}>
        {(props) => (
          <textarea
            {...props}
            rows={2}
            value={note}
            placeholder="What you noticed, in a sentence"
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        )}
      </Field>
      {isImport(item) && (
        <div className={errors.rights === undefined ? "check-field" : "check-field field-bad"}>
          <label className="inline">
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => {
                setRights(e.target.checked);
              }}
            />
            I have the right to use this image
          </label>
          {errors.rights !== undefined && <p className="field-error" role="alert">{errors.rights}</p>}
        </div>
      )}
      {errors.form !== undefined && (
        <p role="alert" className="error">
          {errors.form}
        </p>
      )}
      <div className="actions">
        <button type="button" className="approve" disabled={busy} onClick={() => { submit("approve"); }}>
          Approve
        </button>
        <button type="button" className="reject" disabled={busy} onClick={() => { submit("reject"); }}>
          Reject
        </button>
      </div>
    </form>
  );
}
