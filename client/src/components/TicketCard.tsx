import { memo, useState } from "react";
import { Ticket } from "../types";
import { fetchDescription } from "../api";
import { StatusBadge } from "./StatusBadge";

export const TicketCard = memo(function TicketCard({ ticket }: { ticket: Ticket }) {
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggleDescription() {
    const next = !expanded;
    setExpanded(next);

    if (next && description === null) {
      setLoading(true);
      try {
        const html = await fetchDescription(ticket.key);
        setDescription(html);
      } catch {
        setDescription("<em>Failed to load description.</em>");
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
          href={ticket.url}
          target="_blank"
          rel="noopener"
        >
          {ticket.key}
        </a>
        <StatusBadge status={ticket.status} />
      </div>
      <div className="ticket-summary-row">
        <button
          className={`expand-btn${expanded ? " expanded" : ""}`}
          onClick={toggleDescription}
          title="Show description"
        >
          &#9654;
        </button>
        <div className="ticket-summary">{ticket.title}</div>
      </div>
      {expanded && (
        <div className="ticket-description visible">
          {loading ? (
            <span className="desc-loading">Loading...</span>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: description || "" }} />
          )}
        </div>
      )}
    </div>
  );
}, (prev, next) => prev.ticket.key === next.ticket.key && prev.ticket.status === next.ticket.status && prev.ticket.title === next.ticket.title);
