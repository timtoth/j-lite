# Auto-Expanding Chat Textarea Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat input textarea in `InstructPanel` auto-grow with its content (capped at 40vh), preserve manual resize as an override, and restore the appropriate height after each send.

**Architecture:** All changes are local to two files — `client/src/components/InstructPanel.tsx` (behavior) and `client/src/App.css` (sizing rules). Auto-grow is implemented with `useLayoutEffect` driven by the `input` state. Manual mode is tracked in a ref; once set, it overrides auto-grow until "New Chat" or page reload.

**Tech Stack:** React 19 + TypeScript, Vite. No test framework is configured for the client (per the spec, verification is manual). No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-19-textarea-auto-expand-design.md`

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `client/src/components/InstructPanel.tsx` | Modify | Add refs, auto-grow effect, manual-resize detection, post-send restore, New Chat reset, window resize listener |
| `client/src/App.css` | Modify | Update `.chat-input-row textarea` rule: `max-height: 40vh`, add `overflow-y: auto` |

No new files. No new dependencies.

---

## Task 1: Update CSS for viewport-relative max-height and internal scroll

**Files:**
- Modify: `client/src/App.css:598-612` (the `.chat-input-row textarea` rule)

- [ ] **Step 1: Read the current rule**

Open `client/src/App.css` and locate the `.chat-input-row textarea` block starting at line 598. The current rule is:

```css
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
```

- [ ] **Step 2: Replace with the updated rule**

Change `max-height: 220px;` to `max-height: 40vh;` and add `overflow-y: auto;`. The new rule:

```css
.chat-input-row textarea {
  flex: 1;
  min-height: 60px;
  max-height: 40vh;
  padding: 10px 12px;
  border: 1px solid #d0d0da;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.92rem;
  line-height: 1.5;
  resize: vertical;
  overflow-y: auto;
  color: #1a1a2e;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
```

Leave `:focus` and `:disabled` rules below it unchanged.

- [ ] **Step 3: Verify visually**

Run: `cd client && npm run dev`
Open the app, focus the chat input. The textarea still looks the same at rest (60px min). Resize the browser window taller — the manual drag handle on the textarea now lets you drag it taller than 220px (up to ~40% of the window height). Internal scrolling kicks in once content would exceed the cap.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.css
git commit -m "style: use viewport-relative max-height for chat textarea"
```

---

## Task 2: Add refs and auto-grow effect

**Files:**
- Modify: `client/src/components/InstructPanel.tsx`

This task adds the auto-grow behavior. Manual-resize detection comes in Task 3, post-send restore in Task 4.

- [ ] **Step 1: Update the React import to include `useLayoutEffect`**

In `client/src/components/InstructPanel.tsx:1`, change:

```ts
import { useEffect, useRef, useState, KeyboardEvent } from "react";
```

to:

```ts
import { useEffect, useLayoutEffect, useRef, useState, KeyboardEvent } from "react";
```

- [ ] **Step 2: Add the textarea ref and manual-height ref**

Inside the `InstructPanel` component, after the existing `transcriptRef` declaration (around line 58), add:

```ts
const textareaRef = useRef<HTMLTextAreaElement | null>(null);
const manualHeightRef = useRef<number | null>(null);
```

- [ ] **Step 3: Add the auto-grow `useLayoutEffect`**

After the existing `useEffect` blocks (around line 67), add:

```ts
useLayoutEffect(() => {
  const ta = textareaRef.current;
  if (!ta) return;
  if (manualHeightRef.current !== null) return; // user override wins

  ta.style.height = "auto";
  const maxPx = window.innerHeight * 0.4;
  ta.style.height = Math.min(ta.scrollHeight, maxPx) + "px";
}, [input]);
```

- [ ] **Step 4: Add window resize listener**

Immediately after the auto-grow effect, add:

```ts
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
```

- [ ] **Step 5: Wire the ref into the `<textarea>` element**

Find the `<textarea>` JSX (around line 157) and add `ref={textareaRef}`:

```tsx
<textarea
  ref={textareaRef}
  placeholder="Message Claude (Ctrl/Cmd+Enter to send)"
  value={input}
  onChange={(e) => setInput(e.target.value)}
  onKeyDown={handleKeyDown}
  disabled={sending}
/>
```

- [ ] **Step 6: Verify auto-grow works**

Run: `cd client && npm run dev` (if not already running).
- Type one line — height stays at min (60px).
- Press Enter / type until content wraps — height grows line by line as you type.
- Paste a 50+ line block — height grows up to ~40% of window height, then content scrolls inside the textarea.
- Resize the browser window vertically — the cap follows the new viewport size on the next keystroke.
- Delete content back to one line — height shrinks back to min.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/InstructPanel.tsx
git commit -m "feat: auto-grow chat textarea with content"
```

---

## Task 3: Detect and honor manual resize

**Files:**
- Modify: `client/src/components/InstructPanel.tsx`

After this task, dragging the resize handle locks in a "manual height" that disables auto-grow.

- [ ] **Step 1: Add a manual-resize handler**

Inside the `InstructPanel` component, after `handleKeyDown` (around line 121), add:

```ts
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
```

- [ ] **Step 2: Wire the handler to the textarea**

Update the `<textarea>` JSX to add `onMouseUp`:

```tsx
<textarea
  ref={textareaRef}
  placeholder="Message Claude (Ctrl/Cmd+Enter to send)"
  value={input}
  onChange={(e) => setInput(e.target.value)}
  onKeyDown={handleKeyDown}
  onMouseUp={handleTextareaMouseUp}
  disabled={sending}
/>
```

- [ ] **Step 3: Verify manual resize is honored**

Run the dev server. With auto-grow working from Task 2:
- Drag the resize handle (bottom-right corner of the textarea) to make it tall — say 6-7 lines worth.
- Type a single character — the height should NOT shrink back to one line. It stays at the manually chosen height.
- Drag the handle back down to a smaller size — type and the height stays small even when content overflows (content scrolls inside).
- A simple click-and-release on the textarea (no drag) should NOT trigger manual mode. Verify by clicking once, then typing — auto-grow should still work.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/InstructPanel.tsx
git commit -m "feat: preserve manual textarea resize as override"
```

---

## Task 4: Restore appropriate height after send and on New Chat

**Files:**
- Modify: `client/src/components/InstructPanel.tsx`

After this task, sending a message returns the textarea to either the manual height (if set) or the min-height. New Chat clears the manual preference.

- [ ] **Step 1: Add a previous-input ref to detect the empty transition**

After the existing refs (around the `manualHeightRef` line), add:

```ts
const prevInputRef = useRef<string>("");
```

- [ ] **Step 2: Update the auto-grow effect to handle the cleared-on-send case**

Replace the `useLayoutEffect` from Task 2, Step 3 with:

```ts
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
```

When `input` goes from non-empty to empty (after a send) and the user has a manual height set, reapply it. Otherwise, normal auto-grow runs and naturally collapses to min-height when content is empty.

- [ ] **Step 3: Clear manual mode on New Chat**

Update `handleNewChat` (currently at line 74) to also clear the manual height and inline height:

```ts
function handleNewChat() {
  setSessionId(null);
  setMessages([]);
  manualHeightRef.current = null;
  if (textareaRef.current) {
    textareaRef.current.style.height = "";
  }
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Verify post-send and reset behavior**

Run the dev server. Verify each:

1. **Auto-grow → send → min-height:** Type a multi-line message (no manual resize). Send (Ctrl+Enter). Textarea returns to 60px min-height.
2. **Manual → send → manual height kept:** Drag the textarea to a custom larger size. Type a message. Send. Textarea returns to the manually chosen size, not 60px.
3. **Manual mode persists across multiple sends:** With manual mode set, send another message. The custom height is still applied.
4. **New Chat clears manual mode:** With manual mode set, click "New Chat". Textarea returns to 60px. Type a message — auto-grow works again.
5. **Page reload clears manual mode:** Set manual mode, reload the page. Textarea is at 60px and auto-grow works.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/InstructPanel.tsx
git commit -m "feat: restore textarea size after send, reset on new chat"
```

---

## Task 5: Final verification pass

- [ ] **Step 1: Re-run full manual test list from the spec**

With `npm run dev` running, walk through every item in the spec's "Testing" section:

1. Empty → type one line → no growth.
2. Type/paste enough to wrap → grows line by line.
3. Paste a 50-line block → grows to 40vh, then scrolls internally.
4. Resize browser window taller/shorter → cap follows viewport on next keystroke.
5. Manually drag handle to a custom size → keep typing → height stays at user's choice.
6. Send a message in auto-grow mode → returns to 60px.
7. Manually resize, send a message → returns to the manually chosen size.
8. Manually resize, click "New Chat" → returns to 60px, manual preference cleared.

- [ ] **Step 2: Type-check the client**

Run: `cd client && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `cd client && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Final commit (if anything was tweaked)**

If the verification surfaced any small fixes, commit them now. If everything was already clean, skip this step.

```bash
git status
# if changes:
git add -A
git commit -m "chore: post-verification tweaks for textarea auto-expand"
```

---

## Notes for the implementer

- The codebase is not a git repo at the project root in some checkouts. If `git status` errors with "not a git repository", skip the commit steps but still complete each task's verification.
- There is no test framework wired up for the React client. All verification is manual via the dev server, per the spec.
- Do NOT add `react-textarea-autosize` or any other dependency — the hand-rolled effect is small and intentional.
- `useLayoutEffect` is required (not `useEffect`) so the height update happens before paint and the user never sees a one-frame flash at the wrong height.
