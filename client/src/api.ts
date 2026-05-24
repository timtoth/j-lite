import {
  Ticket,
  Epic,
  EpicChild,
  ListResponse,
  Settings,
  SettingsPatch,
  DiscoveryResult,
  SettingsStatus,
} from "./types";

export async function fetchTickets(): Promise<ListResponse<Ticket>> {
  const res = await fetch("/api/tickets");
  if (!res.ok) throw new Error("Failed to fetch tickets");
  return res.json();
}

export async function fetchDescription(key: string): Promise<string> {
  const res = await fetch(`/api/tickets/${encodeURIComponent(key)}/description`);
  if (!res.ok) throw new Error("Failed to load description");
  const data = await res.json();
  return data.description;
}

export interface InstructResult {
  response: string;
  sessionId: string | null;
}

export async function sendInstruction(
  instruction: string,
  cwd?: string,
  sessionId?: string | null
): Promise<InstructResult> {
  const body: Record<string, unknown> = { instruction };
  if (cwd) body.cwd = cwd;
  if (sessionId) body.sessionId = sessionId;

  const res = await fetch("/api/instruct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = "Request failed";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // response wasn't JSON — keep default message
    }
    throw new Error(message);
  }

  const data = await res.json();
  return {
    response: data.response ?? "",
    sessionId: data.sessionId ?? null,
  };
}

export async function browseFolder(): Promise<string> {
  if (window.tc?.pickFolder) {
    const result = await window.tc.pickFolder();
    return result || "";
  }
  // Browser-only dev (npm run dev:web): the Windows-only HTTP folder
  // route was removed; user types the path manually.
  return "";
}

export async function fetchEpics(): Promise<ListResponse<Epic>> {
  const res = await fetch("/api/epics");
  if (!res.ok) throw new Error("Failed to fetch epics");
  return res.json();
}

export async function fetchEpicChildren(key: string): Promise<ListResponse<EpicChild>> {
  const res = await fetch(`/api/epics/${encodeURIComponent(key)}/children`);
  if (!res.ok) throw new Error("Failed to fetch epic children");
  return res.json();
}

export async function getSettings(): Promise<Settings> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json();
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    let message = "Failed to save settings";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // response wasn't JSON — keep default message
    }
    throw new Error(message);
  }
  return res.json();
}

export async function discoverJiraIds(): Promise<DiscoveryResult> {
  const res = await fetch("/api/settings/discover", { method: "POST" });
  if (!res.ok) {
    let message = "Discovery failed";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // response wasn't JSON — keep default message
    }
    throw new Error(message);
  }
  return res.json();
}

export async function getSettingsStatus(): Promise<SettingsStatus> {
  const res = await fetch("/api/settings/status");
  if (!res.ok) throw new Error("Failed to load status");
  return res.json();
}
