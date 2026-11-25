import { useCallback } from "react";
import { api } from "../../api";
import { useResource } from "../../hooks";
import type { RunDetail } from "../../types";

/** The candidates of every run this project has made; reloads when a run is added. */
export function useRunDetails(runIds: readonly string[]) {
  const key = runIds.join(",");
  const load = useCallback(
    (): Promise<RunDetail[]> => Promise.all((key === "" ? [] : key.split(",")).map((id) => api.run(id))),
    [key],
  );
  return useResource(load);
}
