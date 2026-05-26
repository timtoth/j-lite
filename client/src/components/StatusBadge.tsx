import { statusClass } from "../utils/statusClass";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge ${statusClass(status)}`}>{status}</span>
  );
}
