import type { SaveState } from "../studio/autosave";
import { useWorkspace } from "./context";

const ORDER: readonly SaveState[] = ["error", "blocked", "saving", "saved", "idle"];

const TEXT: Readonly<Record<SaveState, string>> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  blocked: "Not saved yet: finish the marked field",
  error: "Could not save",
};

/** One quiet line for the whole project: the worst state of the autosaving parts wins. */
export function SaveIndicator() {
  const { name, brief, design, brandDraft } = useWorkspace();
  const states = [name.state, brief.state, design.state, brandDraft.state];
  const state = ORDER.find((s) => states.includes(s)) ?? "idle";
  const message = [name, brief, design, brandDraft].find((part) => part.state === "error")?.message;
  return (
    <p className={`save save-${state}`} role="status" aria-live="polite">
      {TEXT[state]}
      {state === "error" && message ? <span className="save-detail"> {message}</span> : null}
    </p>
  );
}
