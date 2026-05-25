import { useState } from "react";
import { JiraSpace } from "../../types";
import { updateJiraSpace } from "../../api";

interface Props {
  spaceKey: string;
  space: JiraSpace;
  onRefresh: (key: string) => Promise<void>;
  onUpdate: (key: string, next: JiraSpace) => void;
}

const FIELD_LABELS: Array<[keyof JiraSpace["fields"], string]> = [
  ["team", "Team field"],
  ["fixVersions", "Fix Versions field"],
  ["storyPoints", "Story Points field"],
  ["sprint", "Sprint field"],
  ["product", "Product field"],
];

export function SpaceAccordion({ spaceKey, space, onRefresh, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTeam, setEditingTeam] = useState(false);
  const [draftTeamId, setDraftTeamId] = useState("");
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  const fieldCount = FIELD_LABELS.filter(([k]) => !!space.fields?.[k]).length;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh(spaceKey);
    } finally {
      setRefreshing(false);
    }
  }

  function startEdit() {
    setDraftTeamId(space.teamId || "");
    setTeamError(null);
    setEditingTeam(true);
  }

  function cancelEdit() {
    setEditingTeam(false);
    setTeamError(null);
  }

  async function saveTeamId() {
    setSavingTeam(true);
    setTeamError(null);
    try {
      const next = await updateJiraSpace(spaceKey, { teamId: draftTeamId.trim() });
      onUpdate(spaceKey, next);
      setEditingTeam(false);
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingTeam(false);
    }
  }

  return (
    <div className="space-accordion">
      <div className="space-accordion__header" onClick={() => setOpen(!open)}>
        <div className="space-accordion__title">
          <span className="space-accordion__chevron">{open ? "▼" : "▶"}</span>
          {spaceKey}
        </div>
        <span className="space-accordion__count">
          {fieldCount} field{fieldCount === 1 ? "" : "s"} discovered
        </span>
      </div>
      {open && (
        <div className="space-accordion__body">
          {editingTeam ? (
            <div className="space-accordion__edit-row">
              <input
                type="text"
                autoFocus
                placeholder="Team UUID"
                value={draftTeamId}
                onChange={(e) => setDraftTeamId(e.target.value)}
                disabled={savingTeam}
              />
              <button onClick={saveTeamId} disabled={savingTeam}>
                {savingTeam ? "Saving…" : "Save"}
              </button>
              <button className="cancel" onClick={cancelEdit} disabled={savingTeam}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-accordion__field-row space-accordion__field-row--editable">
              <span>Team ID</span>
              <span>
                <strong>{space.teamId || "(not set)"}</strong>
                <button type="button" className="space-accordion__edit-btn" onClick={startEdit}>
                  Edit
                </button>
              </span>
            </div>
          )}
          {teamError && <div className="space-accordion__edit-error">{teamError}</div>}

          {FIELD_LABELS.map(([key, label]) => (
            <div className="space-accordion__field-row" key={key}>
              <span>{label}</span>
              <strong>{space.fields?.[key] || "(not discovered)"}</strong>
            </div>
          ))}
          {space.error && (
            <div className="settings-error" style={{ marginTop: 8 }}>
              {space.error}
            </div>
          )}
          <button className="space-accordion__refresh" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Re-discover this space"}
          </button>
        </div>
      )}
    </div>
  );
}
