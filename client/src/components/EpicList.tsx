import { useEffect, useState } from "react";
import { Epic } from "../types";
import { fetchEpics } from "../api";
import { EpicCard } from "./EpicCard";

interface Props {
  refreshKey: number;
}

export function EpicList({ refreshKey }: Props) {
  const [epics, setEpics] = useState<Epic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchEpics()
      .then((res) => setEpics(res.items))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  return (
    <div className="ticket-list">
      {loading && (
        <div className="loading-state">
          <div className="spinner" />
          <div>Loading epics&hellip;</div>
        </div>
      )}
      {!loading && error && (
        <div className="empty-state">
          Failed to load epics. Click Refresh to retry.
        </div>
      )}
      {!loading && !error && epics.length === 0 && (
        <div className="empty-state">No epics found</div>
      )}
      {!loading &&
        !error &&
        epics.map((e) => <EpicCard key={e.key} epic={e} />)}
    </div>
  );
}
