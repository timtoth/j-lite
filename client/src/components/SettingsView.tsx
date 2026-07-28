import { useEffect, useState } from "react";
import { Settings, SettingsPatch, SettingsStatus } from "../types";
import { getSettings, updateSettings, getSettingsStatus } from "../api";
import { ProjectCard } from "./settings/ProjectCard";
import { JiraUserCard } from "./settings/JiraUserCard";
import { JiraProjectCard } from "./settings/JiraProjectCard";
import { AppInfoCard } from "./settings/AppInfoCard";
import { SettingsSection } from "./settings/SettingsSection";

const FOLDER_STORAGE_KEY = "tc_folderPath";

interface Props {
  onClose: () => void;
}

interface DiscoverButtonState {
  discovering: boolean;
  canDiscover: boolean;
  onClick: () => void;
}

export function SettingsView({ onClose }: Props) {
  const [values, setValues] = useState<Settings | null>(null);
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [patch, setPatch] = useState<SettingsPatch>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState(
    () => localStorage.getItem(FOLDER_STORAGE_KEY) || "",
  );
  const [discoverButton, setDiscoverButton] = useState<DiscoverButtonState | null>(null);

  useEffect(() => {
    getSettings().then(setValues).catch(() => setValues(null));
    getSettingsStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  function handleFolderChange(path: string) {
    setFolderPath(path);
    localStorage.setItem(FOLDER_STORAGE_KEY, path);
  }

  async function handleSave() {
    if (!values) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateSettings(patch);
      setValues(updated);
      setPatch({});
      const fresh = await getSettingsStatus();
      setStatus(fresh);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const dirty = Object.keys(patch).length > 0;

  return (
    <div className="settings-view">
      <div className="panel-header">
        <h1>Settings</h1>
        <button className="refresh-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="settings-scroll">
        <SettingsSection title="App Info" defaultOpen={true}>
          <AppInfoCard />
        </SettingsSection>

        <SettingsSection title="Project" defaultOpen={false}>
          <ProjectCard
            status={status}
            folderPath={folderPath}
            onFolderChange={handleFolderChange}
          />
        </SettingsSection>

        {values && (
          <>
            <SettingsSection title="JIRA User" defaultOpen={false}>
              <JiraUserCard values={values} patch={patch} onChange={setPatch} />
            </SettingsSection>

            <SettingsSection
              title="JIRA Project"
              defaultOpen={false}
              headerRight={
                discoverButton && (
                  <button
                    type="button"
                    className="settings-discover-btn"
                    onClick={discoverButton.onClick}
                    disabled={discoverButton.discovering || !discoverButton.canDiscover}
                    title={discoverButton.canDiscover ? undefined : "Save valid JIRA credentials first"}
                  >
                    {discoverButton.discovering ? "Discovering…" : "Discover from JIRA"}
                  </button>
                )
              }
            >
              <JiraProjectCard
                values={values}
                patch={patch}
                onChange={setPatch}
                onValuesChange={setValues}
                status={status}
                dirty={dirty}
                onDiscoverButtonReady={setDiscoverButton}
              />
            </SettingsSection>
          </>
        )}
        {!values && <div className="empty-state">Loading settings…</div>}

        {saveError && <div className="settings-error">{saveError}</div>}

        <div className="settings-actions">
          <button
            className="settings-save-btn"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
