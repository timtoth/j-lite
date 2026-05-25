import { ChangeEvent, useState } from "react";
import { Settings, SettingsPatch, DiscoveryResult, SettingsStatus } from "../../types";
import { discoverJiraIds } from "../../api";

interface Props {
  values: Settings;
  patch: SettingsPatch;
  onChange: (patch: SettingsPatch) => void;
  status: SettingsStatus | null;
  dirty: boolean;
}

interface IdRowProps {
  label: string;
  hint: string;
  fieldKey: keyof SettingsPatch;
  values: Settings;
  patch: SettingsPatch;
  onChange: (patch: SettingsPatch) => void;
  discovered: { id: string; label: string } | null;
}

function IdRow({ label, hint, fieldKey, values, patch, onChange, discovered }: IdRowProps) {
  const current = patch[fieldKey] ?? (values[fieldKey] as string);
  function handle(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...patch, [fieldKey]: e.target.value });
  }
  return (
    <label className="settings-field">
      <span className="settings-field__label">{label}</span>
      <input type="text" value={current} onChange={handle} />
      {discovered && discovered.id !== current && (
        <button
          type="button"
          className="settings-link-btn"
          onClick={() => onChange({ ...patch, [fieldKey]: discovered.id })}
        >
          Use discovered: {discovered.label} ({discovered.id})
        </button>
      )}
      <span className="settings-hint">{hint}</span>
    </label>
  );
}

export function JiraProjectCard({ values, patch, onChange, status, dirty }: Props) {
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const canDiscover = !!status?.jira.ok;

  async function handleDiscover() {
    setDiscovering(true);
    setDiscoveryError(null);
    try {
      const result = await discoverJiraIds();
      setDiscovery(result);
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <section className="settings-card">
      <div className="settings-card__header">
        <h2 className="settings-card__title">JIRA Project</h2>
        <button
          type="button"
          className="settings-discover-btn"
          onClick={handleDiscover}
          disabled={discovering || !canDiscover}
          title={canDiscover ? undefined : "Save valid JIRA credentials first"}
        >
          {discovering ? "Discovering…" : "Discover from JIRA"}
        </button>
      </div>

      {status?.configured && status.jira.ok && !dirty && (
        <div className="settings-success">
          Setup Complete, start using the app!
        </div>
      )}

      <p className="settings-hint">
        These IDs are specific to your JIRA instance. Once your JIRA credentials
        above are saved, click <strong>Discover from JIRA</strong> to fill these
        in automatically.
      </p>

      {discoveryError && <div className="settings-error">{discoveryError}</div>}

      <IdRow
        label="Team field ID"
        hint="The custom-field ID for the 'Team' field in your JIRA instance."
        fieldKey="JIRA_TEAM_FIELD_ID"
        values={values}
        patch={patch}
        onChange={onChange}
        discovered={discovery?.teamFieldId ?? null}
      />
      <IdRow
        label="Team ID"
        hint="The UUID of the team new tickets should be assigned to."
        fieldKey="JIRA_TEAM_ID"
        values={values}
        patch={patch}
        onChange={onChange}
        discovered={discovery?.teamId ?? null}
      />
      <IdRow
        label="Account ID"
        hint="Your JIRA account ID — used as the default assignee for created tickets."
        fieldKey="JIRA_ACCOUNT_ID"
        values={values}
        patch={patch}
        onChange={onChange}
        discovered={discovery?.accountId ?? null}
      />
      <IdRow
        label="Product field ID"
        hint="The custom-field ID for the 'Product' select-list. Default: customfield_12037."
        fieldKey="JIRA_PRODUCT_FIELD_ID"
        values={values}
        patch={patch}
        onChange={onChange}
        discovered={discovery?.productFieldId ?? null}
      />
    </section>
  );
}
