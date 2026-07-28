import { useState } from "react";
import { JiraSpace } from "../../types";
import { updateJiraSpace, deleteJiraSpace, removeCustomField, restoreCustomField } from "../../api";

interface Props {
  spaceKey: string;
  space: JiraSpace;
  onRefresh: (key: string) => Promise<void>;
  onUpdate: (key: string, next: JiraSpace) => void;
  onRemove: (key: string) => void;
}

const FIELD_LABELS: Array<[keyof JiraSpace["fields"], string]> = [
  ["team", "Team field"],
  ["fixVersions", "Fix Versions field"],
  ["storyPoints", "Story Points field"],
  ["sprint", "Sprint field"],
];

export function SpaceAccordion({ spaceKey, space, onRefresh, onUpdate, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingTeam, setEditingTeam] = useState(false);
  const [draftTeamId, setDraftTeamId] = useState("");
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removingField, setRemovingField] = useState<string | null>(null);
  const [restoringField, setRestoringField] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleRemoveCustomField(name: string) {
    setRemovingField(name);
    setFieldError(null);
    try {
      const next = await removeCustomField(spaceKey, name);
      onUpdate(spaceKey, next);
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemovingField(null);
    }
  }

  async function handleRestoreCustomField(name: string) {
    setRestoringField(name);
    setFieldError(null);
    try {
      const next = await restoreCustomField(spaceKey, name);
      onUpdate(spaceKey, next);
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoringField(null);
    }
  }

  function requestRemove(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingRemove(true);
  }

  async function confirmRemove(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingRemove(false);
    setRemoving(true);
    setRemoveError(null);
    try {
      await deleteJiraSpace(spaceKey);
      onRemove(spaceKey);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Remove failed");
      setRemoving(false);
    }
  }

  function cancelRemove(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingRemove(false);
  }

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
          <span className={`settings-chevron${open ? " is-open" : ""}`}>▶</span>
          {spaceKey}
        </div>
        <div className="space-accordion__header-right">
          <span className="space-accordion__count">
            {fieldCount} field{fieldCount === 1 ? "" : "s"} discovered
          </span>
          {confirmingRemove ? (
            <div className="space-accordion__remove-confirm" onClick={(e) => e.stopPropagation()}>
              <span className="space-accordion__remove-confirm-text">Remove?</span>
              <button
                type="button"
                className="space-accordion__remove-confirm-yes"
                onClick={confirmRemove}
                disabled={removing}
              >
                Yes
              </button>
              <button
                type="button"
                className="space-accordion__remove-confirm-no"
                onClick={cancelRemove}
                disabled={removing}
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="space-accordion__remove"
              onClick={requestRemove}
              disabled={removing}
              aria-label={`Remove space ${spaceKey}`}
              title="Remove space"
            >
              🗑
            </button>
          )}
        </div>
      </div>
      {removeError && (
        <div className="settings-error" style={{ padding: "0 12px 8px" }}>
          {removeError}
        </div>
      )}
      <div className={`collapsible${open ? " is-open" : ""}`} aria-hidden={!open}>
        <div className="collapsible__inner">
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
          {space.customFields && Object.keys(space.customFields).length > 0 && (
            <div className="space-accordion__custom-fields">
              <div className="space-accordion__custom-fields-title">Custom fields</div>
              {Object.entries(space.customFields).map(([name, def]) => (
                <div className="space-accordion__field-row" key={name}>
                  <span>{name}</span>
                  <span>
                    <strong title={def.allowedValues.join(", ") || "(no values)"}>
                      {def.fieldId} ({def.allowedValues.length}{" "}
                      value{def.allowedValues.length === 1 ? "" : "s"})
                    </strong>
                    <button
                      type="button"
                      className="space-accordion__remove-field"
                      onClick={() => handleRemoveCustomField(name)}
                      disabled={removingField === name}
                      aria-label={`Remove custom field ${name}`}
                      title="Remove custom field"
                    >
                      🗑
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {space.excludedCustomFields && space.excludedCustomFields.length > 0 && (
            <div className="space-accordion__excluded-fields">
              <div className="space-accordion__custom-fields-title">Excluded fields</div>
              {space.excludedCustomFields.map((name) => (
                <div className="space-accordion__field-row" key={name}>
                  <span>{name}</span>
                  <button
                    type="button"
                    className="space-accordion__restore-field"
                    onClick={() => handleRestoreCustomField(name)}
                    disabled={restoringField === name}
                  >
                    {restoringField === name ? "Restoring…" : "Restore"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {fieldError && <div className="space-accordion__edit-error">{fieldError}</div>}
          {space.error && (
            <div className="settings-error" style={{ marginTop: 8 }}>
              {space.error}
            </div>
          )}
          <button className="space-accordion__refresh" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Re-discover this space"}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
