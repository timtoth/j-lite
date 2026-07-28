import { useEffect, useState } from "react";
import { UpdateStatus } from "../../global";

export function AppInfoCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (!window.tc?.getAppVersion) {
      setSupported(false);
      return;
    }
    setSupported(true);
    window.tc.getAppVersion().then(setVersion).catch(() => setVersion(null));
    window.tc.onUpdateStatus?.(setStatus);
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

  return (
    <div>
      <div className="settings-row">
        <span className="settings-row__label">Version</span>
        <span className="settings-row__value">{version ?? "…"}</span>
      </div>

      <button
        type="button"
        className="settings-discover-btn"
        onClick={handleCheck}
        disabled={checking}
      >
        {checking ? "Checking…" : "Check for Updates"}
      </button>

      {status?.state === "up-to-date" && (
        <div className="settings-success">✓ You're up to date.</div>
      )}

      {status?.state === "downloading" && (
        <div className="settings-hint">Downloading update…</div>
      )}

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
