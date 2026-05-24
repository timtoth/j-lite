import { useEffect, useState } from "react";
import { Ticket } from "../types";
import { fetchTickets } from "../api";
import { TicketCard } from "./TicketCard";
import { EpicList } from "./EpicList";

interface Props {
  refreshKey: number;
  onRefresh: () => void;
}

type Tab = "todo" | "epics";

export function TicketPanel({ refreshKey, onRefresh }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("todo");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [epicRefreshKey, setEpicRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchTickets()
      .then(setTickets)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  function handleRefresh() {
    if (activeTab === "todo") {
      onRefresh();
    } else {
      setEpicRefreshKey((k) => k + 1);
    }
  }

  return (
    <div className="ticket-panel">
      <div className="panel-header">
        <h1>{activeTab === "todo" ? "My Todo" : "Epics"}</h1>
        <button className="refresh-btn" onClick={handleRefresh}>
          Refresh
        </button>
      </div>
      <div className="tab-bar">
        <button
          className={`tab-btn${activeTab === "todo" ? " active" : ""}`}
          onClick={() => setActiveTab("todo")}
        >
          My Todo
        </button>
        <button
          className={`tab-btn${activeTab === "epics" ? " active" : ""}`}
          onClick={() => setActiveTab("epics")}
        >
          Epics
        </button>
      </div>
      <div className={`tab-content${activeTab === "todo" ? " active" : ""}`}>
        <div className="ticket-list">
          {loading && (
            <div className="loading-state">
              <div className="spinner" />
              <div>Loading tickets&hellip;</div>
            </div>
          )}
          {!loading && error && (
            <div className="empty-state">
              Failed to load tickets. Click Refresh to retry.
            </div>
          )}
          {!loading && !error && tickets.length === 0 && (
            <div className="empty-state">No tickets assigned</div>
          )}
          {!loading &&
            !error &&
            tickets.map((t) => <TicketCard key={t.key} ticket={t} />)}
        </div>
      </div>
      <div className={`tab-content${activeTab === "epics" ? " active" : ""}`}>
        <EpicList refreshKey={epicRefreshKey} />
      </div>
    </div>
  );
}
