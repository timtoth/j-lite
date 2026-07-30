import { useEffect, useState } from "react";
import { UpdateStatus } from "../../global";
import { CircleArrowUp, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { describeUpdateStatus, UpdateStatusIcon } from "./update-status-view";

const STATUS_ICONS: Record<UpdateStatusIcon, typeof CircleCheck> = {
  check: CircleCheck,
  x: CircleX,
  "arrow-up": CircleArrowUp,
  loader: LoaderCircle,
};

export function AppInfoCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [supported, setSupported] = useState(() => !!window.tc?.getAppVersion);

  useEffect(() => {
    if (!window.tc?.getAppVersion) {
      setSupported(false);
      return;
    }
    setSupported(true);
    window.tc.getAppVersion().then(setVersion).catch(() => setVersion(null));
    return window.tc.onUpdateStatus?.(setStatus);
  }, []);

  async function handleCheck() {
    setStatus({ state: "checking" });
    try {
      await window.tc!.checkForUpdates();
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Check failed",
      });
    }
  }

  async function handleApply() {
    if (!status) return;
    await window.tc!.applyUpdate(status);
  }

  if (!supported) {
    return (
      <div className="settings-hint">
        Version unknown (browser dev mode).
      </div>
    );
  }

  const checking = status?.state === "checking";
  const isReady = status?.state === "ready";
  const applyLabel =
    isReady && status.action === "restart" ? "Restart to Update" : "Download";

  const statusView = describeUpdateStatus(status);
  const StatusIcon = statusView ? STATUS_ICONS[statusView.icon] : null;

  return (
    <div>
      <div className="settings-version-row">
        <span className="settings-row__label">Version</span>
        <span className="settings-version-row__number">{version ?? "…"}</span>

        {statusView && StatusIcon && (
          <span
            className="settings-version-row__status"
            style={{ color: statusView.color }}
            title={statusView.title}
            role="status"
          >
            <StatusIcon
              size={15}
              strokeWidth={2}
              className={statusView.spin ? "tc-spin" : undefined}
              aria-hidden="true"
            />
            {statusView.label}
          </span>
        )}

        <button
          type="button"
          className="settings-discover-btn settings-version-row__btn"
          onClick={handleCheck}
          disabled={checking || status?.state === "downloading"}
        >
          {checking ? "Checking…" : "Check for Updates"}
        </button>
      </div>

      {isReady && (
        <div className="update-available-banner">
          <span>
            Update available{status.action === "open-link" ? ` — v${status.version}` : ""}
          </span>
          <button type="button" className="settings-discover-btn" onClick={handleApply}>
            {applyLabel}
          </button>
        </div>
      )}

      {status?.state === "error" && (
        <div className="settings-error">{status.message}</div>
      )}
    </div>
  );
}
