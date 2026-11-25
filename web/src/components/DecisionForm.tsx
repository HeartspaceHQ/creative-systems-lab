import { useState, type SyntheticEvent } from "react";
import { api } from "../api";
import { Field } from "./Field";
import type { Candidate, Verdict } from "../types";

const REVIEWER_KEY = "csl.reviewer";

function storedReviewer(): string {
  try {
    return window.localStorage.getItem(REVIEWER_KEY) ?? "";
  } catch {
    return "";
  }
}

interface Props {
  readonly run: string;
  readonly candidate: Candidate;
  readonly onDecided: () => void;
}

export function DecisionForm({ run, candidate, onDecided }: Props) {
  const [reviewer, setReviewer] = useState(storedReviewer);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Readonly<{ reviewer?: string; note?: string; override?: string }>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (verdict: Verdict): Promise<void> => {
    setError(null);
    const approving = verdict === "approve" && !candidate.hardPass;
    const found = {
      ...(reviewer.trim() === "" ? { reviewer: "Add your name so the decision is recorded." } : {}),
      ...(approving && !override ? { override: "The automatic checks flagged this image. Tick this box if you have looked at it and still want it." } : {}),
      ...(approving && override && note.trim() === "" ? { note: "Add a short comment on why this image is fine." } : {}),
    };
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await api.decide(run, { candidate: candidate.id, verdict, reviewer, note, override });
      try {
        window.localStorage.setItem(REVIEWER_KEY, reviewer);
      } catch {
        // Remembering the name is a convenience only.
      }
      setNote("");
      setOverride(false);
      onDecided();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "request failed");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: SyntheticEvent): void => {
    event.preventDefault();
  };

  const decided = candidate.decision !== null;
  return (
    <form className="decision" onSubmit={onSubmit} aria-labelledby="decision-title">
      <h3 id="decision-title">{decided ? "Change the decision" : "Your decision"}</h3>
      <Field label="Reviewer" error={problems.reviewer}>
        {(props) => <input {...props} value={reviewer} onChange={(e) => { setReviewer(e.target.value); }} autoComplete="name" />}
      </Field>
      <Field label="Comment" error={problems.note}>
        {(props) => (
          <textarea
            {...props}
            rows={2}
            value={note}
            placeholder="What you saw, in a sentence"
            onChange={(e) => { setNote(e.target.value); }}
          />
        )}
      </Field>
      {!candidate.hardPass && (
        <div className={problems.override === undefined ? "check-field" : "check-field field-bad"}>
          <label className="inline">
            <input type="checkbox" checked={override} onChange={(e) => { setOverride(e.target.checked); }} />
            Approve anyway, I have looked at this image
          </label>
          {problems.override !== undefined && <p className="field-error" role="alert">{problems.override}</p>}
        </div>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="approve" disabled={busy} onClick={() => { void submit("approve"); }}>
          Approve
        </button>
        <button type="button" className="reject" disabled={busy} onClick={() => { void submit("reject"); }}>
          Reject
        </button>
      </div>
      <p className="fine">Each decision is appended to the run&apos;s sealed log with your name and the time.</p>
    </form>
  );
}
