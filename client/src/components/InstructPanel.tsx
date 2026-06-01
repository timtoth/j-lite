import { useEffect, useLayoutEffect, useRef, useState, KeyboardEvent } from "react";
import { streamInstruction, getSettings } from "../api";
import { ChatMessage, ChatMessageData } from "./ChatMessage";
import { SpaceModal } from "./SpaceModal";

const FOLDER_STORAGE_KEY = "tc_folderPath";
const CHAT_STORAGE_KEY = "tc_chat";
const LAST_SPACE_KEY = "tc_lastSpace";
const TICKET_KEY_REGEX = /[A-Z][A-Z0-9]+-\d+/g;

interface Props {
  onInstructionSent: () => void;
}

interface PersistedChat {
  sessionId: string | null;
  messages: ChatMessageData[];
}

function loadChat(): PersistedChat {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return { sessionId: null, messages: [] };
    const parsed = JSON.parse(raw) as PersistedChat;
    if (!parsed || !Array.isArray(parsed.messages)) {
      return { sessionId: null, messages: [] };
    }
    return {
      sessionId: parsed.sessionId ?? null,
      messages: parsed.messages,
    };
  } catch {
    return { sessionId: null, messages: [] };
  }
}

function saveChat(chat: PersistedChat) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chat));
  } catch {
    // quota or unavailable — degrade to in-memory only
    console.warn("tc_chat: localStorage unavailable, history will not persist");
  }
}

export function InstructPanel({ onInstructionSent }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(
    () => loadChat().sessionId
  );
  const [messages, setMessages] = useState<ChatMessageData[]>(
    () => loadChat().messages
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [knownSpaces, setKnownSpaces] = useState<string[]>([]);
  const [pendingSend, setPendingSend] = useState<{ text: string; detected: string[] } | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => setKnownSpaces(Object.keys(s.JIRA_SPACES || {})))
      .catch(() => setKnownSpaces([]));
  }, []);

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const manualHeightRef = useRef<number | null>(null);
  const prevInputRef = useRef<string>("");
  const currentStreamRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveChat({ sessionId, messages });
  }, [sessionId, messages]);

  useEffect(() => {
    return () => {
      currentStreamRef.current?.abort();
      currentStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    const justCleared = prevInputRef.current.length > 0 && input.length === 0;
    prevInputRef.current = input;

    if (justCleared && manualHeightRef.current !== null) {
      ta.style.height = manualHeightRef.current + "px";
      return;
    }

    if (manualHeightRef.current !== null) return; // user override wins

    ta.style.height = "auto";
    const maxPx = window.innerHeight * 0.4;
    ta.style.height = Math.min(ta.scrollHeight, maxPx) + "px";
  }, [input]);

  useEffect(() => {
    function handleResize() {
      const ta = textareaRef.current;
      if (!ta) return;
      if (manualHeightRef.current !== null) return;

      ta.style.height = "auto";
      const maxPx = window.innerHeight * 0.4;
      ta.style.height = Math.min(ta.scrollHeight, maxPx) + "px";
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handleNewChat() {
    currentStreamRef.current?.abort();
    currentStreamRef.current = null;
    setSessionId(null);
    setMessages([]);
    manualHeightRef.current = null;
    prevInputRef.current = "";
    if (textareaRef.current) {
      textareaRef.current.style.height = "";
    }
    try {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function detectSpaces(text: string): string[] {
    const matches = text.match(TICKET_KEY_REGEX) ?? [];
    const prefixes = matches
      .map((k) => k.split("-")[0])
      .filter((p, i, arr) => arr.indexOf(p) === i);
    return prefixes;
  }

  async function actuallySend(text: string, space: string) {
    const userMessage: ChatMessageData = { role: "user", content: text };
    const liveAssistant: ChatMessageData = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, userMessage, liveAssistant]);
    setInput("");
    setSending(true);

    const ctrl = new AbortController();
    currentStreamRef.current = ctrl;

    const cwd = (localStorage.getItem(FOLDER_STORAGE_KEY) || "").trim() || undefined;

    let sawError = false;

    try {
      const result = await streamInstruction(
        { instruction: text, cwd, sessionId, space: space || null },
        {
          onDelta: (delta) => {
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = prev.slice();
              const last = next[next.length - 1];
              if (last.role !== "assistant" || last.error) return prev;
              next[next.length - 1] = { ...last, content: last.content + delta };
              return next;
            });
          },
          onError: (message) => {
            sawError = true;
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = prev.slice();
              const last = next[next.length - 1];
              if (last.role !== "assistant") return prev;
              next[next.length - 1] = {
                role: "assistant",
                content: "Error: " + message,
                error: true,
              };
              return next;
            });
          },
        },
        ctrl.signal,
      );

      if (result.sessionId) setSessionId(result.sessionId);
      if (space) localStorage.setItem(LAST_SPACE_KEY, space);
      onInstructionSent();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Cancellation: New Chat / unmount already cleared the messages or will.
        // Do not write an error bubble.
      } else if (!sawError) {
        // Surface unexpected transport errors as a final-message error bubble.
        const message = err instanceof Error ? err.message : "Something went wrong";
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const next = prev.slice();
          const last = next[next.length - 1];
          if (last.role !== "assistant") return prev;
          next[next.length - 1] = {
            role: "assistant",
            content: "Error: " + message,
            error: true,
          };
          return next;
        });
      }
    } finally {
      setSending(false);
      currentStreamRef.current = null;
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    const detected = detectSpaces(text);
    if (detected.length === 1) {
      return actuallySend(text, detected[0]);
    }
    if (detected.length === 0) {
      const last = localStorage.getItem(LAST_SPACE_KEY);
      if (last && knownSpaces.includes(last)) {
        return actuallySend(text, last);
      }
    }
    setPendingSend({ text, detected });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleTextareaMouseUp() {
    const ta = textareaRef.current;
    if (!ta) return;

    // Compute the height auto-grow would have set right now.
    const prevInline = ta.style.height;
    ta.style.height = "auto";
    const maxPx = window.innerHeight * 0.4;
    const autoHeight = Math.min(ta.scrollHeight, maxPx);
    // Restore whatever inline height was there so we don't visibly flicker.
    ta.style.height = prevInline;

    const actualHeight = ta.offsetHeight;

    // Tolerance for sub-pixel rounding.
    if (Math.abs(actualHeight - autoHeight) > 2) {
      manualHeightRef.current = actualHeight;
    }
  }

  return (
    <div className="instruct-panel">
      <div className="panel-header">
        <h1>Instruct Claude</h1>
        <button
          className="new-chat-btn"
          onClick={handleNewChat}
          disabled={sending || messages.length === 0}
          title="Start a new conversation"
        >
          New Chat
        </button>
      </div>

      <div className="chat-transcript" ref={transcriptRef}>
        {messages.length === 0 && !sending && (
          <div className="chat-empty">
            Ask Claude anything. Reference tickets by key (e.g., ABC-4337) to include their details.
          </div>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} message={m} />
        ))}
      </div>

      <div className="chat-input-row">
        <textarea
          ref={textareaRef}
          placeholder="Message Claude (Ctrl/Cmd+Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onMouseUp={handleTextareaMouseUp}
          disabled={sending}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={sending || !input.trim()}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {pendingSend && (
        <SpaceModal
          knownSpaces={knownSpaces}
          detectedSpaces={pendingSend.detected}
          onConfirm={(space) => {
            const t = pendingSend.text;
            setPendingSend(null);
            actuallySend(t, space);
          }}
          onCancel={() => setPendingSend(null)}
        />
      )}
    </div>
  );
}
