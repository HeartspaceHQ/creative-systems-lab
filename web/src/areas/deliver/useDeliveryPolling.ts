import { useEffect } from "react";
import { studioApi } from "../../studio/api";
import type { Delivery } from "../../studio/types";

const POLL_MS = 1500;

/** While a delivery is running, ask for it every moment and tell the project when it changes. */
export function useDeliveryPolling(projectId: string, running: Delivery | undefined, onChange: () => void): void {
  const runningId = running?.id;
  useEffect(() => {
    if (runningId === undefined) return undefined;
    const timer = window.setInterval(() => {
      studioApi.delivery(projectId, runningId).then(
        (next) => {
          if (next.state !== "running") onChange();
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [projectId, runningId, onChange]);
}
