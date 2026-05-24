import { useEffect, useLayoutEffect, useRef, useState, KeyboardEvent } from "react";
import { sendInstruction } from "../api";
import { ChatMessage, ChatMessageData } from "./ChatMessage";

const FOLDER_STORAGE_KEY = "tc_folderPath";
const CHAT_STORAGE_KEY = "tc_chat";

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

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const manualHeightRef = useRef<number | null>(null);
  const prevInputRef = useRef<string>("");

  useEffect(() => {
    saveChat({ sessionId, messages });
  }, [sessionId, messages]);

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

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const userMessage: ChatMessageData = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      const cwd = (localStorage.getItem(FOLDER_STORAGE_KEY) || "").trim() || undefined;
      const result = await sendInstruction(text, cwd, sessionId);
      const assistantMessage: ChatMessageData = {
        role: "assistant",
        content: result.response || "(empty response)",
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (result.sessionId) setSessionId(result.sessionId);
      onInstructionSent();
    } catch (err) {
      const errorMessage: ChatMessageData = {
        role: "assistant",
        content:
          "Error: " + (err instanceof Error ? err.message : "Something went wrong"),
        error: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setSending(false);
    }
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
            Ask Claude anything. Reference tickets by key (e.g., RL-4337) to include their details.
          </div>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} message={m} />
        ))}
        {sending && (
          <div className="chat-message chat-message--assistant chat-message--thinking">
            <div className="chat-message-bubble">
              <span className="spinner" /> Thinking&hellip;
            </div>
          </div>
        )}
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
    </div>
  );
}
