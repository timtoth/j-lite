# Claude Chat Interface — Design

**Date:** 2026-04-21
**Status:** Draft / awaiting user review

## Problem

The current `InstructPanel` sends a single instruction to Claude and shows the single corresponding response. Every Send is a brand-new `claude -p` invocation with no memory of prior turns. Users want to carry on a real conversation: follow-up questions, clarifications, iterative refinement.

## Goals

- Multi-turn conversation with retained context across messages.
- Standard AI-chat UX: scrolling transcript, user/assistant bubbles, input pinned at the bottom.
- **New Chat** button that clears the transcript and starts a fresh context.
- History survives page reloads on the same machine.

## Non-goals (v1)

- Multiple saved conversations / sidebar of past chats.
- Server-side history persistence.
- Streaming token-by-token responses.
- Syntax highlighting inside code blocks.
- Editing, deleting, or copying individual messages.

## Architecture

### Frontend — `client/src/components/InstructPanel.tsx`

Component state becomes a single `Chat` object:

```ts
type Message = {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
};

type Chat = {
  sessionId: string | null;
  messages: Message[];
};
```

- Persist the entire `Chat` object to `localStorage` under key `tc_chat`.
- On mount, rehydrate from `localStorage` if present; otherwise start empty (`sessionId: null`, `messages: []`).
- Folder picker keeps its existing key `tc_folderPath` — unchanged.

### Backend — `routes/instruct.js`

Accepts an optional `sessionId` in the POST body alongside the existing `instruction` and `cwd`:

- If `sessionId` is null/absent → spawn `claude -p --output-format json <prompt>` (new session).
- If `sessionId` is present → spawn `claude -p --resume <sessionId> --output-format json <prompt>` (resume existing session).

Parse the CLI's JSON output, extract the assistant response text and the `session_id`, respond with `{ response, sessionId }`.

The existing ticket-key detection (`TICKET_KEY_REGEX` → `getTicketDetails` → prepended context block) runs on each turn's user instruction, so referencing a new ticket mid-conversation still pulls fresh JIRA data.

## Data flow per turn

1. User types, presses Send (or Ctrl/Cmd+Enter). Frontend optimistically appends a user `Message` to the transcript, disables input, shows a "Thinking…" bubble.
2. Frontend POSTs `{ instruction, cwd, sessionId }` to `/api/instruct`.
3. Backend augments with JIRA context if ticket keys are present, spawns `claude` with or without `--resume`, parses the JSON result.
4. Backend returns `{ response, sessionId }`. Frontend stores `sessionId` (same as before on continued chats, new on first turn), appends the assistant `Message`, persists the updated `Chat` to `localStorage`, re-enables input, auto-scrolls to bottom.
5. On error: append an assistant `Message` with `error: true`; render with an error style. Preserve `sessionId` so the user can retry.

## UI

**Header**
- Title: `Instruct Claude`
- `New Chat` button
- Folder picker (existing)

**Transcript**
- Scrolling vertical list of message bubbles.
- User messages: right-aligned, filled accent color.
- Assistant messages: left-aligned, neutral background.
- Assistant messages render **markdown** via `react-markdown` + `remark-gfm` (tables, fenced code blocks, task lists, autolinks, strikethrough). User messages render as plain text.
- Error messages: left-aligned, error style, inline retry is out of scope for v1 (user can just re-send).
- Auto-scroll to bottom whenever a message is appended.

**Input**
- Textarea + Send button pinned at the bottom of the panel.
- Ctrl/Cmd+Enter sends (existing shortcut preserved).
- While awaiting a response: textarea and Send disabled; a "Thinking…" bubble with the existing spinner appears at the end of the transcript.

**New Chat button**
- Clears transcript, resets `sessionId` to null, removes `tc_chat` from `localStorage`.
- No confirmation dialog.

## Dependencies to add

- `react-markdown`
- `remark-gfm`

Both are small, well-maintained, and safe-by-default (raw HTML escaped, no `dangerouslySetInnerHTML` needed).

## Styling notes

- Existing `.instruct-panel`, `.panel-header`, `.response-area`, `.response-content`, `.response-loading`, `.spinner` classes in `App.css` are mostly replaced/restructured.
- New classes needed: `.chat-transcript`, `.chat-message`, `.chat-message--user`, `.chat-message--assistant`, `.chat-message--error`, `.chat-input-row`, `.new-chat-btn`.
- Markdown element styles scoped to `.chat-message--assistant` (`h1..h6`, `p`, `ul`, `ol`, `code`, `pre`, `table`, `blockquote`, `a`).

## Error handling

- Network / HTTP error: append assistant error message; keep `sessionId` unchanged; log to console.
- Claude CLI non-zero exit: backend returns 500 with `stderr`; frontend shows it as an error message.
- Invalid JSON from CLI: backend returns 500 with a clear error; frontend shows the error message.
- localStorage unavailable / quota exceeded: degrade to in-memory only; log a console warning.

## Testing

- **Frontend:** manual verification in the browser — send multi-turn conversation, confirm context is retained ("What did I just ask?"), reload page and confirm transcript persists, click New Chat and confirm it clears and the next message starts a fresh context.
- **Backend:** manual curl against `/api/instruct` — first call without `sessionId` returns a `sessionId`; second call with that `sessionId` sees prior context; call with a made-up `sessionId` returns an error gracefully.
- No automated test suite exists in the repo; not adding one for this change.

## Open questions

None — all design decisions confirmed with user during brainstorming.
