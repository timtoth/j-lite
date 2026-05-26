import { ChangeEvent, useState } from "react";
import { Settings, SettingsPatch, DiscoveryResult, SettingsStatus, JiraSpace } from "../../types";
import { discoverJiraIds } from "../../api";
import { SpaceAccordion } from "./SpaceAccordion";
import { AddSpaceForm } from "./AddSpaceForm";

interface Props {
  values: Settings;
  patch: SettingsPatch;
  onChange: (patch: SettingsPatch) => void;
  onValuesChange: (next: Settings) => void;
  status: SettingsStatus | null;
  dirty: boolean;
}

export function JiraProjectCard({
  values, patch, onChange, onValuesChange, status, dirty,
}: Props) {
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const canDiscover = !!status?.jira.ok;

  async function runDiscovery(spaceKey?: string): Promise<DiscoveryResult | null> {
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const result = await discoverJiraIds(spaceKey);
      if (result.accountId && !spaceKey) {
        onChange({ ...patch, JIRA_ACCOUNT_ID: result.accountId.id });
      }
      const nextSpaces = { ...values.JIRA_SPACES };
      for (const [k, v] of Object.entries(result.spaces)) {
        nextSpaces[k] = v;
      }
      onValuesChange({ ...values, JIRA_SPACES: nextSpaces });
      return result;
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : "Discovery failed");
      return null;
    } finally {
      setDiscovering(false);
    }
  }

  function setAccountId(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...patch, JIRA_ACCOUNT_ID: e.target.value });
  }

  const accountId = patch.JIRA_ACCOUNT_ID ?? values.JIRA_ACCOUNT_ID;
  const spaces: Record<string, JiraSpace> = values.JIRA_SPACES ?? {};

  return (
    <section className="settings-card">
      <div className="settings-card__header">
        <h2 className="settings-card__title">JIRA Project</h2>
        <button
          type="button"
          className="settings-discover-btn"
          onClick={() => runDiscovery()}
          disabled={discovering || !canDiscover}
          title={canDiscover ? undefined : "Save valid JIRA credentials first"}
        >
          {discovering ? "Discovering…" : "Discover from JIRA"}
        </button>
      </div>

      {status?.configured && status.jira.ok && !dirty && (
        <div className="settings-success">Setup Complete, start using the app!</div>
      )}

      <p className="settings-hint">
        These IDs are specific to your JIRA instance. Once your JIRA credentials
        above are saved, click <strong>Discover from JIRA</strong> to fill these
        in automatically.
      </p>

      {discoveryError && <div className="settings-error">{discoveryError}</div>}

      <label className="settings-field">
        <span className="settings-field__label">Account ID</span>
        <input type="text" value={accountId} onChange={setAccountId} />
        <span className="settings-hint">Your JIRA account ID — used as the default assignee.</span>
      </label>

      <h3 className="settings-card__title" style={{ marginTop: 18 }}>Spaces</h3>
      {Object.keys(spaces).length === 0 && (
        <p className="settings-hint">No spaces discovered yet. Add one below.</p>
      )}
      {Object.entries(spaces).map(([key, space]) => (
        <SpaceAccordion
          key={key}
          spaceKey={key}
          space={space}
          onRefresh={async (k) => { await runDiscovery(k); }}
          onUpdate={(k, next) => {
            onValuesChange({
              ...values,
              JIRA_SPACES: { ...values.JIRA_SPACES, [k]: next },
            });
          }}
          onRemove={(k) => {
            const nextSpaces = { ...values.JIRA_SPACES };
            delete nextSpaces[k];
            onValuesChange({ ...values, JIRA_SPACES: nextSpaces });
          }}
        />
      ))}

      <AddSpaceForm
        onAdd={async (key) => { await runDiscovery(key); }}
        disabled={!canDiscover}
      />
    </section>
  );
}
