import { TicketPanel } from "./components/TicketPanel";
import { InstructPanel } from "./components/InstructPanel";
import { useState, useCallback } from "react";

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="layout">
      <TicketPanel refreshKey={refreshKey} onRefresh={triggerRefresh} />
      <InstructPanel onInstructionSent={triggerRefresh} />
    </div>
  );
}
