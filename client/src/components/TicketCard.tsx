import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";
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
          <ChevronRight size={14} strokeWidth={2.25} aria-hidden="true" />
        </button>
        <div className="ticket-summary">{ticket.title}</div>
      </div>
      <div className={`collapsible${expanded ? " is-open" : ""}`} aria-hidden={!expanded}>
        <div className="collapsible__inner">
          <div className="ticket-description">
            {loading ? (
              <span className="desc-loading">Loading...</span>
            ) : (
              <div dangerouslySetInnerHTML={{ __html: description || "" }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => prev.ticket.key === next.ticket.key && prev.ticket.status === next.ticket.status && prev.ticket.title === next.ticket.title);
