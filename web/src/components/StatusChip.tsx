import { STATUS_LABELS } from "../format";
import type { Status } from "../types";

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`status status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
