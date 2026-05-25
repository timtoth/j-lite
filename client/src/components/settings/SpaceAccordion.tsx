import { useState } from "react";
import { JiraSpace } from "../../types";

interface Props {
  spaceKey: string;
  space: JiraSpace;
  onRefresh: (key: string) => Promise<void>;
}

const FIELD_LABELS: Array<[keyof JiraSpace["fields"], string]> = [
  ["team", "Team field"],
  ["fixVersions", "Fix Versions field"],
  ["storyPoints", "Story Points field"],
  ["sprint", "Sprint field"],
  ["product", "Product field"],
];

export function SpaceAccordion({ spaceKey, space, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fieldCount = FIELD_LABELS.filter(([k]) => !!space.fields?.[k]).length;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh(spaceKey);
    } finally {
      setRefreshing(false);
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
          <div className="space-accordion__field-row">
            <span>Team ID</span>
            <strong>{space.teamId || "(not set)"}</strong>
          </div>
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
