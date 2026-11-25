import { useCallback, useEffect, useState } from "react";
import { studioApi } from "../studio/api";
import type { Job } from "../types";

export interface Generation {
  /** The run in progress or just finished, if any. */
  readonly job: Job | null;
  readonly error: string | null;
  readonly running: boolean;
  /** The run that finished most recently in this visit, so its images can be picked out. */
  readonly finishedRun: string | null;
  readonly start: (models: readonly string[], candidates: number) => Promise<void>;
}

const POLL_MS = 1000;

/** Lives with the project, not with the Images area, so a run keeps going while the designer works elsewhere. */
export function useGeneration(projectId: string, beforeStart: () => Promise<void>, onFinished: () => void): Generation {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishedRun, setFinishedRun] = useState<string | null>(null);
  const jobId = job?.state === "running" ? job.id : null;

  useEffect(() => {
    if (jobId === null) return undefined;
    const timer = window.setInterval(() => {
      studioApi.job(jobId).then(
        (next) => {
          setJob(next);
          if (next.state === "done") {
            setFinishedRun(next.runId);
            onFinished();
          }
        },
        (failure: unknown) => {
          setJob(null);
          setError(failure instanceof Error ? failure.message : "Lost track of the run.");
        },
      );
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [jobId, onFinished]);

  const start = useCallback(
    async (models: readonly string[], candidates: number): Promise<void> => {
      setError(null);
      setFinishedRun(null);
      try {
        await beforeStart();
        setJob(await studioApi.startRun(projectId, models, candidates));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not start the run.");
      }
    },
    [beforeStart, projectId],
  );

  return { job, error, running: job?.state === "running", finishedRun, start };
}
