import { Ticket, Epic, EpicChild } from "./types";

export async function fetchTickets(): Promise<Ticket[]> {
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
  const res = await fetch("/api/browse-folder");
  const data = await res.json();
  return data.folder || "";
}

export async function fetchEpics(): Promise<Epic[]> {
  const res = await fetch("/api/epics");
  if (!res.ok) throw new Error("Failed to fetch epics");
  return res.json();
}

export async function fetchEpicChildren(key: string): Promise<EpicChild[]> {
  const res = await fetch(`/api/epics/${encodeURIComponent(key)}/children`);
  if (!res.ok) throw new Error("Failed to fetch epic children");
  return res.json();
}
