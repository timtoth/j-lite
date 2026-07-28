import { ChangeEvent } from "react";
import { Settings, SettingsPatch } from "../../types";

interface Props {
  values: Settings;
  patch: SettingsPatch;
  onChange: (patch: SettingsPatch) => void;
}

const TOKEN_DOC_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

export function JiraUserCard({ values, patch, onChange }: Props) {
  function set(key: keyof SettingsPatch) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      onChange({ ...patch, [key]: e.target.value });
    };
  }

  const tokenPlaceholder =
    values.JIRA_API_TOKEN === null
      ? "Paste your API token"
      : `•••• ${values.JIRA_API_TOKEN.last4} (leave blank to keep)`;

  return (
    <>
      <label className="settings-field">
        <span className="settings-field__label">Base URL</span>
        <input
          type="text"
          value={patch.JIRA_BASE_URL ?? values.JIRA_BASE_URL}
          onChange={set("JIRA_BASE_URL")}
          placeholder="https://your-domain.atlassian.net"
        />
        <span className="settings-hint">
          Your Atlassian site URL (no trailing slash).
        </span>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">Email</span>
        <input
          type="email"
          value={patch.JIRA_EMAIL ?? values.JIRA_EMAIL}
          onChange={set("JIRA_EMAIL")}
          placeholder="you@example.com"
        />
        <span className="settings-hint">
          The email you log in to JIRA with.
        </span>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">API token</span>
        <input
          type="password"
          value={patch.JIRA_API_TOKEN ?? ""}
          onChange={set("JIRA_API_TOKEN")}
          placeholder={tokenPlaceholder}
          autoComplete="off"
        />
        <span className="settings-hint">
          Generate one at{" "}
          <a href={TOKEN_DOC_URL} target="_blank" rel="noreferrer">
            id.atlassian.com → API tokens
          </a>
          . Stored locally; never sent anywhere except your JIRA instance.
        </span>
      </label>
    </>
  );
}
