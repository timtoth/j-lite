import { memo, useState } from "react";
import { Epic, EpicChild } from "../types";
import { fetchEpicChildren } from "../api";
import { StatusBadge } from "./StatusBadge";

export const EpicCard = memo(function EpicCard({ epic }: { epic: Epic }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<EpicChild[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggleChildren() {
    const next = !expanded;
    setExpanded(next);

    if (next && children === null) {
      setLoading(true);
      try {
        const data = await fetchEpicChildren(epic.key);
        setChildren(data.items);
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="ticket-card">
      <div className="ticket-top">
        <a
          className="ticket-key"
          href={epic.url}
          target="_blank"
          rel="noopener"
        >
          {epic.key}
        </a>
        <StatusBadge status={epic.status} />
      </div>
      <div className="ticket-summary-row">
        <button
          className={`expand-btn${expanded ? " expanded" : ""}`}
          onClick={toggleChildren}
          title="Show child tickets"
        >
          &#9654;
        </button>
        <div className="ticket-summary">{epic.title}</div>
      </div>
      {expanded && (
        <div className="epic-children">
          {loading && (
            <span className="desc-loading">Loading child tickets...</span>
          )}
          {!loading && children && children.length === 0 && (
            <div className="epic-children-empty">No child tickets found</div>
          )}
          {!loading &&
            children &&
            children.map((child) => (
              <div key={child.key} className="epic-child-row">
                <a
                  className="ticket-key"
                  href={child.url}
                  target="_blank"
                  rel="noopener"
                >
                  {child.key}
                </a>
                <span className="epic-child-title">{child.title}</span>
                <StatusBadge status={child.status} />
                <span className="epic-child-assignee">{child.assignee}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}, (prev, next) => prev.epic.key === next.epic.key && prev.epic.status === next.epic.status && prev.epic.title === next.epic.title);
