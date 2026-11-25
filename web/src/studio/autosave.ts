import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../http";

/** `blocked`: there is an edit that is not valid yet, so nothing was sent. */
export type SaveState = "idle" | "saving" | "saved" | "blocked" | "error";

/** Thrown by `flush` when the latest edit is not valid yet, so the server still holds an older version. */
export class EditNotValid extends Error {
  constructor() {
    super("A change is not valid yet, so it was not saved. Correct the marked field and try again.");
    this.name = "EditNotValid";
  }
}

type Outcome = { readonly saved: true } | { readonly saved: false; readonly error: Error };
const SAVED: Outcome = { saved: true };

export interface Autosaved<T> {
  readonly draft: T;
  /** Replace the draft with the designer's edit and schedule a save. */
  readonly edit: (next: T) => void;
  /** Replace the draft with what the server holds, without saving. */
  readonly reset: (next: T) => void;
  /**
   * Save any pending edit now. Resolves only when the server holds the latest edit; rejects with
   * `EditNotValid` when the edit could not be sent, or with the server's error when it was refused.
   */
  readonly flush: () => Promise<void>;
  readonly state: SaveState;
  readonly message: string | null;
  /** Sentences for the fields the server refused, keyed by the body path. */
  readonly fieldErrors: Readonly<Record<string, string>>;
}

interface Options<T> {
  readonly initial: T;
  readonly save: (value: T) => Promise<void>;
  /** Edits that are not valid yet (a half-typed colour) wait here instead of being sent. */
  readonly canSave?: (value: T) => boolean;
  readonly delay?: number;
}

const DEFAULT_DELAY = 700;

/**
 * Holds a draft that lives as long as its owner, saves it shortly after the last edit and once more
 * when the owner goes away, so switching areas or leaving the project never drops input.
 */
export function useAutosave<T>(options: Options<T>): Autosaved<T> {
  const { initial, save, canSave, delay = DEFAULT_DELAY } = options;
  const [draft, setDraft] = useState<T>(initial);
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const latest = useRef({ draft, save, canSave });
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const inflight = useRef<Promise<Outcome> | null>(null);

  useEffect(() => {
    latest.current = { draft, save, canSave };
  });

  const run = useCallback(async (): Promise<Outcome> => {
    if (inflight.current !== null) await inflight.current;
    const current = latest.current;
    if (!dirty.current) return SAVED;
    if (current.canSave && !current.canSave(current.draft)) {
      setState("blocked");
      return { saved: false, error: new EditNotValid() };
    }
    dirty.current = false;
    setState("saving");
    const task = current.save(current.draft).then(
      (): Outcome => {
        setMessage(null);
        setFieldErrors({});
        setState(dirty.current ? "saving" : "saved");
        return SAVED;
      },
      (error: unknown): Outcome => {
        dirty.current = true;
        setState("error");
        const failure = error instanceof Error ? error : new Error("Could not save your changes.");
        setMessage(failure.message);
        setFieldErrors(error instanceof ApiError ? error.fields : {});
        return { saved: false, error: failure };
      },
    );
    inflight.current = task;
    const outcome = await task;
    inflight.current = null;
    return outcome;
  }, []);

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const edit = useCallback(
    (next: T): void => {
      latest.current = { ...latest.current, draft: next };
      setDraft(next);
      dirty.current = true;
      setState("saving");
      clearTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void run();
      }, delay);
    },
    [clearTimer, delay, run],
  );

  const reset = useCallback((next: T): void => {
    latest.current = { ...latest.current, draft: next };
    dirty.current = false;
    setDraft(next);
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    clearTimer();
    let outcome = await run();
    // An edit made while that save was on its way is saved too, so the server ends with the latest.
    while (outcome.saved && dirty.current) outcome = await run();
    if (!outcome.saved) throw outcome.error;
  }, [clearTimer, run]);

  useEffect(
    () => () => {
      clearTimer();
      if (dirty.current) void run();
    },
    [clearTimer, run],
  );

  return { draft, edit, reset, flush, state, message, fieldErrors };
}
