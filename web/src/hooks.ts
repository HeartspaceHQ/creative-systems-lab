import { useCallback, useEffect, useState } from "react";

export type Resource<T> =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "ready"; readonly value: T };

type Settled<T> =
  | { readonly source: unknown; readonly value: T }
  | { readonly source: unknown; readonly error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "request failed";
}

/** Loads `load()` whenever `load` changes; `reload` runs it again. `load` must be stable. */
export function useResource<T>(load: () => Promise<T>): { resource: Resource<T>; reload: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    load().then(
      (value) => {
        if (live) setSettled({ source: load, value });
      },
      (error: unknown) => {
        if (live) setSettled({ source: load, error: messageOf(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [load, round]);

  const reload = useCallback(() => {
    setRound((n) => n + 1);
  }, []);

  let resource: Resource<T> = { state: "loading" };
  if (settled?.source === load) {
    resource = "error" in settled ? { state: "error", message: settled.error } : { state: "ready", value: settled.value };
  }
  return { resource, reload };
}
