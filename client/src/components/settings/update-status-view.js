/**
 * Maps an UpdateStatus to the icon, label, and color the App Info row shows.
 * Returns null when there is nothing to display (no check has run yet).
 *
 * Kept as plain JS so `node --test` can exercise it without a transpile step.
 * `AppInfoCard.tsx` maps the returned `icon` string to a lucide component.
 */
export function describeUpdateStatus(status) {
  if (!status) return null;

  switch (status.state) {
    case "checking":
      return { icon: "loader", label: "Checking…", color: "#8888a0", spin: true, title: undefined };
    case "downloading":
      return { icon: "loader", label: "Downloading…", color: "#8888a0", spin: true, title: undefined };
    case "up-to-date":
      return { icon: "check", label: "Up to date", color: "#7ee2a0", spin: false, title: undefined };
    case "ready":
      return { icon: "arrow-up", label: "Update Available", color: "#e6c25a", spin: false, title: undefined };
    case "error":
      return { icon: "x", label: "Check failed", color: "#f5b7b1", spin: false, title: status.message };
    default:
      return null;
  }
}
