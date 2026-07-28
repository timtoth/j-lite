import { SettingsStatus } from "../../types";
import { FolderPicker } from "../FolderPicker";

interface Props {
  status: SettingsStatus | null;
  folderPath: string;
  onFolderChange: (path: string) => void;
}

export function ProjectCard({ status, folderPath, onFolderChange }: Props) {
  return (
    <>
      <div className="settings-row">
        <span className="settings-row__label">Claude CLI</span>
        <span className="settings-row__value">
          {status === null && "Checking…"}
          {status?.claude.available && (
            <span className="status-pill status-pill--ok">
              Connected{status.claude.version ? ` (${status.claude.version})` : ""}
            </span>
          )}
          {status && !status.claude.available && (
            <span className="status-pill status-pill--err">
              Not found on PATH
            </span>
          )}
        </span>
      </div>

      <div className="settings-row">
        <span className="settings-row__label">Repo folder</span>
        <div className="settings-row__control">
          <FolderPicker value={folderPath} onChange={onFolderChange} />
        </div>
      </div>
      <p className="settings-hint">
        The working directory Claude uses when running your instructions. Pick the
        repo or project folder you want it to act on.
      </p>
    </>
  );
}
