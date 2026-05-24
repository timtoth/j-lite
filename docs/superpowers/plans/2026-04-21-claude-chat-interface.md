# Claude Chat Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-shot `InstructPanel` into a multi-turn chat interface with persistent history, a New Chat button, and markdown rendering.

**Architecture:** Frontend `InstructPanel` becomes a chat transcript with localStorage persistence (`tc_chat`). Backend `/api/instruct` accepts an optional `sessionId`; when present it spawns `claude -p --resume <id> --output-format json`, when absent it spawns `claude -p --output-format json`. The returned `session_id` is handed back to the client and reused on subsequent turns. Markdown rendering via `react-markdown` + `remark-gfm`.

**Tech Stack:** React 19 + TypeScript + Vite (client), Express + Node (server), `claude` CLI, `react-markdown`, `remark-gfm`.

**Notes:**
- The repo is not a git repo (per environment). Commit steps are written but can be skipped or replaced with a save/snapshot equivalent.
- There is no automated test suite. Verification is manual per the spec; each task ends with an explicit "verify this" step rather than a written test.

**Spec:** `docs/superpowers/specs/2026-04-21-claude-chat-interface-design.md`

---

## File Structure

- Modify: `routes/instruct.js` — accept `sessionId`, switch between fresh/resume spawns, return session id.
- Modify: `client/src/api.ts` — update `sendInstruction` signature to include `sessionId` and return `{ response, sessionId }`.
- Modify: `client/src/components/InstructPanel.tsx` — full rewrite to chat transcript.
- Create: `client/src/components/ChatMessage.tsx` — renders a single message bubble; handles markdown for assistant messages.
- Modify: `client/src/App.css` — remove obsolete `.response-area` / `.response-content` styles used only by `InstructPanel`, add chat transcript styles.
- Modify: `client/package.json` — add `react-markdown` and `remark-gfm` dependencies.

---

## Task 1: Add markdown dependencies to the client

**Files:**
- Modify: `client/package.json`
- Modify: `client/package-lock.json` (auto)

- [ ] **Step 1: Install the packages**

Run from `client/`:
```bash
npm install react-markdown remark-gfm
```

Expected: both packages added under `dependencies` in `client/package.json`, lockfile updated, no peer-dependency errors (React 19 is supported by current `react-markdown`).

- [ ] **Step 2: Verify versions are pinned**

Open `client/package.json` and confirm `react-markdown` and `remark-gfm` appear under `dependencies` with a caret-ranged version (e.g., `"react-markdown": "^9.x.x"`).

- [ ] **Step 3: Commit**

```bash
git add client/package.json client/package-lock.json
git commit -m "feat(client): add react-markdown and remark-gfm"
```

---

## Task 2: Update backend `/api/instruct` to support sessions

**Files:**
- Modify: `routes/instruct.js` (the `POST /api/instruct` handler)

- [ ] **Step 1: Replace the POST handler**

In `routes/instruct.js`, replace the entire `router.post("/api/instruct", ...)` handler (currently lines 31–91) with:

```js
router.post("/api/instruct", async (req, res) => {
  const { instruction, cwd, sessionId } = req.body;

  if (!instruction) {
    return res.status(400).json({ error: "instruction is required" });
  }

  // Detect ticket keys and fetch their details (unchanged behavior)
  const keys = [...new Set(instruction.match(TICKET_KEY_REGEX) || [])];
  let context = "";
  if (keys.length > 0) {
    const details = await Promise.allSettled(keys.map(getTicketDetails));
    const resolved = details
      .filter((d) => d.status === "fulfilled")
      .map((d) => d.value);
    if (resolved.length > 0) {
      context = "Here is the JIRA ticket data referenced in the request:\n\n" +
        resolved.join("\n---\n\n") +
        "\n---\n\n";
    }
  }

  const prompt = context + instruction;
  log(`PROMPT: ${prompt}`);
  log(`SESSION: ${sessionId || "(new)"}`);

  const args = ["-p", "--output-format", "json"];
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  args.push(prompt);

  const spawnOpts = {
    timeout: 120_000,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (cwd) spawnOpts.cwd = cwd;

  const child = spawn("claude", args, spawnOpts);

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  child.on("error", (err) => {
    log(`SPAWN ERROR: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });

  child.on("close", (code) => {
    log(`EXIT CODE: ${code}`);
    log(`STDOUT: ${stdout.slice(0, 2000)}`);
    log(`STDERR: ${stderr}`);
    if (res.headersSent) return;
    if (code !== 0) {
      return res.status(500).json({ error: stderr || `Process exited with code ${code}` });
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      log(`JSON PARSE ERROR: ${err.message}`);
      return res.status(500).json({ error: "Failed to parse Claude output: " + err.message });
    }

    // claude -p --output-format json returns an object with a `result` string
    // and a `session_id`. Field name defensive: fall back across variants.
    const response = parsed.result ?? parsed.response ?? parsed.text ?? "";
    const returnedSessionId = parsed.session_id ?? parsed.sessionId ?? sessionId ?? null;

    if (!response) {
      log(`UNEXPECTED CLAUDE JSON SHAPE: ${JSON.stringify(parsed).slice(0, 500)}`);
    }

    res.json({ response, sessionId: returnedSessionId });
  });
});
```

Key changes vs. current:
- Reads `sessionId` from the body.
- Spawns with `--output-format json`, and adds `--resume <id>` when `sessionId` is present.
- Parses stdout as JSON and extracts `result` (text) + `session_id`.
- Returns `{ response, sessionId }` instead of `{ response }`.
- Timeout raised from 60s to 120s — multi-turn replies with JIRA context can be slower.

- [ ] **Step 2: Restart the server and smoke-test a fresh session**

Start/restart the server (`node server.js` or however it's normally launched).

Run:
```bash
curl -s -X POST http://localhost:<PORT>/api/instruct \
  -H "Content-Type: application/json" \
  -d '{"instruction":"Reply with the single word: apple"}'
```

Expected: JSON response like `{"response":"apple\n","sessionId":"<uuid-like-string>"}`. Copy the `sessionId` for the next step.

- [ ] **Step 3: Smoke-test a resumed session**

Using the `sessionId` from step 2:
```bash
curl -s -X POST http://localhost:<PORT>/api/instruct \
  -H "Content-Type: application/json" \
  -d '{"instruction":"What word did I just ask you to say?","sessionId":"<paste-id-here>"}'
```

Expected: response mentions "apple", and `sessionId` in the response matches (or is a continuation of) the one you sent.

- [ ] **Step 4: Smoke-test a bad session id**

```bash
curl -s -X POST http://localhost:<PORT>/api/instruct \
  -H "Content-Type: application/json" \
  -d '{"instruction":"hi","sessionId":"definitely-not-a-real-id"}'
```

Expected: HTTP 500 with a JSON error body (from the CLI's stderr). The frontend will render this as an error message later.

- [ ] **Step 5: Commit**

```bash
git add routes/instruct.js
git commit -m "feat(server): support sessionId for multi-turn chat via --resume"
```

---

## Task 3: Update client API helper

**Files:**
- Modify: `client/src/api.ts` (lines 16–32)

- [ ] **Step 1: Replace `sendInstruction`**

In `client/src/api.ts`, replace the existing `sendInstruction` function with:

```ts
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `client/`:
```bash
npx tsc -b --noEmit
```

Expected: no errors. (The only caller of `sendInstruction` is `InstructPanel.tsx`, which will be rewritten in Task 4 — for now the old call site will error. If so, that's expected and will be fixed in Task 4. Move on.)

- [ ] **Step 3: Commit**

```bash
git add client/src/api.ts
git commit -m "feat(client): sendInstruction returns sessionId and accepts prior sessionId"
```

---

## Task 4: Create `ChatMessage` component

**Files:**
- Create: `client/src/components/ChatMessage.tsx`

- [ ] **Step 1: Write the component**

Create `client/src/components/ChatMessage.tsx` with:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type ChatRole = "user" | "assistant";

export interface ChatMessageData {
  role: ChatRole;
  content: string;
  error?: boolean;
}

interface Props {
  message: ChatMessageData;
}

export function ChatMessage({ message }: Props) {
  const classes = ["chat-message", `chat-message--${message.role}`];
  if (message.error) classes.push("chat-message--error");

  return (
    <div className={classes.join(" ")}>
      <div className="chat-message-bubble">
        {message.role === "assistant" && !message.error ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        ) : (
          <span className="chat-message-plain">{message.content}</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `client/`:
```bash
npx tsc -b --noEmit
```

Expected: no errors from `ChatMessage.tsx`. (`InstructPanel.tsx` may still have errors from Task 3 — still expected.)

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ChatMessage.tsx
git commit -m "feat(client): add ChatMessage component with markdown rendering"
```

---

## Task 5: Rewrite `InstructPanel` as a chat transcript

**Files:**
- Modify: `client/src/components/InstructPanel.tsx` (full rewrite)

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `client/src/components/InstructPanel.tsx` with:

```tsx
import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { sendInstruction } from "../api";
import { FolderPicker } from "./FolderPicker";
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
  const [folderPath, setFolderPath] = useState(
    () => localStorage.getItem(FOLDER_STORAGE_KEY) || ""
  );

  const initial = loadChat();
  const [sessionId, setSessionId] = useState<string | null>(initial.sessionId);
  const [messages, setMessages] = useState<ChatMessageData[]>(initial.messages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveChat({ sessionId, messages });
  }, [sessionId, messages]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  function handleFolderChange(path: string) {
    setFolderPath(path);
    localStorage.setItem(FOLDER_STORAGE_KEY, path);
  }

  function handleNewChat() {
    setSessionId(null);
    setMessages([]);
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
      const cwd = folderPath.trim() || undefined;
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
        <FolderPicker value={folderPath} onChange={handleFolderChange} />
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
          placeholder="Message Claude (Ctrl/Cmd+Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `client/`:
```bash
npx tsc -b --noEmit
```

Expected: no errors anywhere in the project.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/InstructPanel.tsx
git commit -m "feat(client): multi-turn chat transcript with session persistence"
```

---

## Task 6: Update styling

**Files:**
- Modify: `client/src/App.css`

- [ ] **Step 1: Remove obsolete styles**

In `client/src/App.css`, delete these blocks (no other components use them):
- `.response-area` (lines ~461–465)
- `.response-area .response-label` (lines ~466–473)
- `.response-content` (lines ~475–486)
- `.response-content.empty` (lines ~488–491)
- `.response-loading` (lines ~493–500)
- `.response-loading .spinner` (lines ~502–510)

Also delete `.instruct-body` (lines ~409–415) and the `.instruct-body textarea`, `.instruct-body textarea:focus` blocks (lines ~417–436) — the new panel uses `.chat-input-row` instead.

Also delete the old `.send-btn` standalone block if it uses `align-self: flex-end; margin-top: 12px;` (lines ~438–459) — a new one will be defined inside `.chat-input-row`.

Verify with a project-wide search (e.g., in your editor) that no other component references any of the deleted class names. Epics/ticket panels use their own classes and should be untouched.

- [ ] **Step 2: Append the new chat styles**

Add the following to the bottom of `client/src/App.css`, before the `@media (max-width: 768px)` block:

```css
/* ---- Right Column: Chat ---- */
.instruct-panel .new-chat-btn {
  flex-shrink: 0;
  padding: 6px 12px;
  background: #fff;
  color: #4c5ce5;
  border: 1px solid #c8cef7;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.instruct-panel .new-chat-btn:hover:not(:disabled) {
  background: #eef0ff;
  border-color: #4c5ce5;
}

.instruct-panel .new-chat-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-transcript {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-transcript::-webkit-scrollbar { width: 6px; }
.chat-transcript::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}

.chat-empty {
  color: #8888a0;
  font-size: 0.9rem;
  font-style: italic;
  text-align: center;
  padding: 48px 16px;
}

.chat-message {
  display: flex;
  max-width: 100%;
}

.chat-message--user {
  justify-content: flex-end;
}

.chat-message--assistant {
  justify-content: flex-start;
}

.chat-message-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 0.92rem;
  line-height: 1.55;
  word-break: break-word;
}

.chat-message--user .chat-message-bubble {
  background: #4c5ce5;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.chat-message--assistant .chat-message-bubble {
  background: #fff;
  color: #2a2a3e;
  border: 1px solid #e0e0e6;
  border-bottom-left-radius: 4px;
}

.chat-message--error .chat-message-bubble {
  background: #fdecea;
  color: #922b21;
  border-color: #f5b7b1;
}

.chat-message--thinking .chat-message-bubble {
  color: #6c7bf7;
  display: flex;
  align-items: center;
  gap: 10px;
}

.chat-message--thinking .spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2.5px solid #e0e0f0;
  border-top-color: #6c7bf7;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.chat-message-plain {
  white-space: pre-wrap;
}

/* Markdown inside assistant bubbles */
.chat-message--assistant .chat-message-bubble p { margin: 0 0 8px; }
.chat-message--assistant .chat-message-bubble p:last-child { margin-bottom: 0; }
.chat-message--assistant .chat-message-bubble h1,
.chat-message--assistant .chat-message-bubble h2,
.chat-message--assistant .chat-message-bubble h3,
.chat-message--assistant .chat-message-bubble h4 {
  margin: 10px 0 6px;
  font-weight: 600;
  line-height: 1.3;
}
.chat-message--assistant .chat-message-bubble h1 { font-size: 1.15rem; }
.chat-message--assistant .chat-message-bubble h2 { font-size: 1.05rem; }
.chat-message--assistant .chat-message-bubble h3 { font-size: 0.98rem; }
.chat-message--assistant .chat-message-bubble ul,
.chat-message--assistant .chat-message-bubble ol {
  margin: 4px 0 8px 22px;
  padding: 0;
}
.chat-message--assistant .chat-message-bubble li { margin-bottom: 2px; }
.chat-message--assistant .chat-message-bubble a {
  color: #4c5ce5;
  text-decoration: none;
}
.chat-message--assistant .chat-message-bubble a:hover { text-decoration: underline; }
.chat-message--assistant .chat-message-bubble code {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.85em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.chat-message--assistant .chat-message-bubble pre {
  background: #1a1a2e;
  color: #e0e0e8;
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
  font-size: 0.85em;
}
.chat-message--assistant .chat-message-bubble pre code {
  background: none;
  padding: 0;
  color: inherit;
}
.chat-message--assistant .chat-message-bubble blockquote {
  border-left: 3px solid #d0d0da;
  padding-left: 10px;
  margin: 6px 0;
  color: #6a6a80;
}
.chat-message--assistant .chat-message-bubble table {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
  font-size: 0.88em;
}
.chat-message--assistant .chat-message-bubble th,
.chat-message--assistant .chat-message-bubble td {
  border: 1px solid #e0e0e6;
  padding: 6px 8px;
  text-align: left;
}
.chat-message--assistant .chat-message-bubble th { background: #f4f5f7; }
.chat-message--assistant .chat-message-bubble hr {
  border: none;
  border-top: 1px solid #e0e0e6;
  margin: 10px 0;
}

.chat-input-row {
  border-top: 1px solid #e0e0e6;
  padding: 16px 28px;
  display: flex;
  gap: 12px;
  align-items: flex-end;
  background: #fafafc;
}

.chat-input-row textarea {
  flex: 1;
  min-height: 60px;
  max-height: 220px;
  padding: 10px 12px;
  border: 1px solid #d0d0da;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.92rem;
  line-height: 1.5;
  resize: vertical;
  color: #1a1a2e;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.chat-input-row textarea:focus {
  outline: none;
  border-color: #6c7bf7;
  box-shadow: 0 0 0 3px rgba(108, 123, 247, 0.15);
}

.chat-input-row textarea:disabled {
  background: #f0f0f4;
  cursor: not-allowed;
}

.chat-input-row .send-btn {
  flex-shrink: 0;
  background: #4c5ce5;
  color: #fff;
  border: none;
  padding: 10px 22px;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.chat-input-row .send-btn:hover:not(:disabled) { background: #3b4bd4; }
.chat-input-row .send-btn:disabled { opacity: 0.55; cursor: not-allowed; }
```

- [ ] **Step 2: Commit**

```bash
git add client/src/App.css
git commit -m "style(client): chat transcript, bubbles, and markdown styles"
```

---

## Task 7: End-to-end manual verification

**Files:** none — this is a verification-only task.

- [ ] **Step 1: Start dev servers**

Start the backend (`node server.js` or the project's usual command) and the client dev server (`npm run dev` in `client/`).

- [ ] **Step 2: Golden path — multi-turn context**

In the browser:
1. Open the Instruct Claude panel. Confirm the empty-state message is visible.
2. Send: `My favorite color is teal. Remember that.`
3. Wait for the response. Confirm user message is right-aligned (purple), assistant message is left-aligned (white card).
4. Send: `What did I tell you my favorite color was?`
5. Confirm the response mentions teal (proves `--resume` context is working).

- [ ] **Step 3: Persistence across reload**

1. Reload the page.
2. Confirm the two prior user messages and two assistant responses are still visible.
3. Send: `And what color did I say?` — confirm it still knows (proves the `sessionId` also persisted, not just the transcript text).

- [ ] **Step 4: New Chat clears context**

1. Click **New Chat**. Confirm the transcript clears and the empty-state message returns.
2. Send: `What is my favorite color?` — confirm the response does NOT know teal (proves a fresh session was started).

- [ ] **Step 5: Markdown rendering**

Send: `` Reply with this exact markdown: `# Heading` then a bullet list of three items, then a code fence with the line `console.log("hi")`. ``

Confirm the heading renders as a styled heading, the list as bullet points, and the code block as monospace on a dark background — i.e., it is NOT displayed as raw `#` characters and backticks.

- [ ] **Step 6: Error handling**

1. Stop the backend server.
2. Send a message from the UI. Confirm an error bubble (red/pink) appears with a readable message.
3. Restart the backend. Send another message. Confirm the chat continues using the prior `sessionId` (the error didn't wipe it).

- [ ] **Step 7: Ticket detail injection still works**

Send: `Summarize the ticket RL-1 in one sentence.` (use any valid key from the left panel). Confirm the response references real ticket content, proving the JIRA-context prepend still runs per turn.

- [ ] **Step 8: Commit any final CSS/polish tweaks found during testing**

If you had to adjust anything during verification:
```bash
git add -A
git commit -m "chore: verification-driven tweaks to chat UI"
```

---

## Done

At this point:
- Multi-turn chat works with persistent context, persistent UI history (localStorage), New Chat reset, and markdown rendering for assistant replies.
- Ticket-key JIRA context injection continues to work on every turn.
- Errors are shown inline without destroying the session.
