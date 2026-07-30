import { UpdateStatus } from "../../global";

export type UpdateStatusIcon = "check" | "x" | "arrow-up" | "loader";

export interface UpdateStatusView {
  icon: UpdateStatusIcon;
  label: string;
  color: string;
  spin: boolean;
  title: string | undefined;
}

export function describeUpdateStatus(
  status: UpdateStatus | null,
): UpdateStatusView | null;
