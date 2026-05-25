import { useEffect, useState } from "react";
import { Ticket } from "../types";
import { fetchTickets } from "../api";
import { TicketCard } from "./TicketCard";
import { EpicList } from "./EpicList";
import { SettingsView } from "./SettingsView";

interface Props {
  refreshKey: number;
  onRefresh: () => void;
}

type Tab = "todo" | "epics";
type View = "tickets" | "settings";

export function TicketPanel({ refreshKey, onRefresh }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("todo");
  const [view, setView] = useState<View>("tickets");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [epicRefreshKey, setEpicRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchTickets()
      .then((res) => {
        setTickets(res.items);
        setConfigured(res.configured);
        if (!res.configured) setView("settings");
      })
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

  if (view === "settings") {
    return (
      <div className="ticket-panel">
        <SettingsView onClose={() => setView("tickets")} />
      </div>
    );
  }

  return (
    <div className="ticket-panel">
      <div className="panel-header">
        <h1>{activeTab === "todo" ? "My Todo" : "Epics"}</h1>
        <div className="panel-header__actions">
          <button
            className="refresh-btn refresh-btn--primary"
            onClick={handleRefresh}
          >
            <span className="refresh-btn__icon" aria-hidden="true">↻</span>
            Refresh
          </button>
          <button
            className="gear-btn"
            onClick={() => setView("settings")}
            aria-label="Open settings"
            title="Settings"
          >
            ⚙
          </button>
        </div>
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
          {!loading && !configured && (
            <div className="empty-state">
              JIRA isn't connected yet. Click the gear icon to set up your
              connection.
            </div>
          )}
          {!loading && configured && error && (
            <div className="empty-state">
              Failed to load tickets. Click Refresh to retry.
            </div>
          )}
          {!loading && configured && !error && tickets.length === 0 && (
            <div className="empty-state">No tickets assigned</div>
          )}
          {!loading &&
            configured &&
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
