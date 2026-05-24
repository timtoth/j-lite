# Auto-Expanding Chat Textarea — Design

**Date:** 2026-05-19
**Status:** Draft / awaiting user review

## Problem

The chat input textarea in `InstructPanel` (`client/src/components/InstructPanel.tsx:157`) is fixed at a 60px minimum height (~2 lines) and only grows if the user manually drags the resize handle. When users type or paste prompts longer than two lines, the content scrolls inside the textarea and they cannot see their full message without manually resizing. This is a friction point for any non-trivial prompt.

## Goals

- Textarea automatically grows as the user types or pastes wrapped/newline content, so the full draft is visible without manual intervention.
- Growth is bounded so the textarea never crowds out the chat transcript.
- Manual resize is preserved as an override — if the user wants a larger (or smaller) input area, that choice sticks.
- After sending a message, the textarea returns to a sensible "ready for next message" state that respects whatever sizing preference the user has expressed.

## Non-goals

- Animating the height transition.
- Saving the user's manual height across page reloads or across separate chats.
- Auto-shrinking below the configured `min-height`.
- Touch/mobile-specific resize handle improvements.

## Behavior

### Empty state
- Height equals CSS `min-height` (60px).

### Typing / pasting (auto-grow mode)
- As content grows or shrinks, the textarea height tracks the content's `scrollHeight`.
- Height is capped at `40vh` (40% of the viewport height). At the cap, the textarea scrolls internally.
- Recomputes on window resize, since the cap is viewport-relative.

### Manual resize (override mode)
- The user can drag the resize handle (`resize: vertical` remains enabled in CSS).
- Once the user has manually resized, auto-grow is disabled — their chosen height wins, even if it's larger or smaller than `scrollHeight` would dictate.
- Manual mode persists across sends within the session: the remembered height is reapplied after each send and continues to override auto-grow for subsequent drafts.
- Manual mode is cleared by "New Chat" or a page reload, after which the next draft starts fresh in auto-grow mode.

### After send (input cleared)
- If the user manually resized at any point: the textarea returns to that remembered manual height.
- If the user never manually resized: the textarea returns to `min-height` (60px).

### New Chat / reset
- Clears the remembered manual height. The next draft starts fresh in auto-grow mode at `min-height`.

## Architecture

All changes are local to two files:

- `client/src/components/InstructPanel.tsx` — the textarea behavior.
- `client/src/App.css` — the `.chat-input-row textarea` selector.

No new components, no new dependencies.

### State and refs (InstructPanel.tsx)

Add to the existing component:

```ts
const textareaRef = useRef<HTMLTextAreaElement | null>(null);
const manualHeightRef = useRef<number | null>(null); // null = auto-grow mode
```

### Auto-grow effect

A `useLayoutEffect` keyed on `input`:

1. If `manualHeightRef.current !== null`, return early (user's manual height wins).
2. Reset `textarea.style.height = "auto"` so `scrollHeight` reflects the true content height.
3. Compute `maxPx = window.innerHeight * 0.4`.
4. Set `textarea.style.height = Math.min(textarea.scrollHeight, maxPx) + "px"`.

`useLayoutEffect` (rather than `useEffect`) avoids a one-frame flash at the wrong height.

### Manual-resize detection

Attach an `onMouseUp` handler to the textarea. After the mouseup:

1. Compute the height auto-grow *would* have set (same formula as above, against current content).
2. Compare to `textarea.offsetHeight`.
3. If they differ by more than ~2px (tolerance for sub-pixel rounding), store `textarea.offsetHeight` in `manualHeightRef.current`.

This is a pragmatic detector — there's no native `onresize` for textareas. Mouseup after a drag is the canonical signal.

### Send / reset behavior

`handleSend` already clears `input` on success. Add a `useLayoutEffect` keyed on `input` that runs *after* the auto-grow effect (or extend the same effect) so that when the input transitions from non-empty to empty:

- If `manualHeightRef.current !== null`: set `textarea.style.height = manualHeightRef.current + "px"`.
- Else: clear inline height (`textarea.style.height = ""`) so CSS `min-height` takes over.

A simple way to detect the transition is to track previous input length in another ref, or just always reset on empty (auto-grow does the right thing on the next keystroke either way).

### New Chat hook

In the existing `handleNewChat`, also set `manualHeightRef.current = null` and clear the inline height.

### Window resize

Add a `window.resize` listener that re-runs the auto-grow computation (no-op when in manual mode). Throttle is unnecessary at this scale.

### Cleanup

All effects and listeners use standard React cleanup. Nothing global persists outside the component.

## CSS changes (`App.css`, `.chat-input-row textarea`)

| Property        | Current   | New          | Reason                                           |
|-----------------|-----------|--------------|--------------------------------------------------|
| `min-height`    | `60px`    | `60px`       | Unchanged                                        |
| `max-height`    | `220px`   | `40vh`       | Viewport-relative cap, scales with window        |
| `resize`        | `vertical`| `vertical`   | Unchanged — manual resize is still allowed       |
| `overflow-y`    | (default) | `auto`       | Internal scroll once the cap is reached          |

No other rules change.

## Edge cases

- **Paste of very long content:** Auto-grow snaps to cap; internal scrollbar appears. No flicker because `useLayoutEffect` updates before paint.
- **User shrinks below content height manually:** Manual mode is honored — content scrolls inside the user-chosen smaller area.
- **User resizes back to roughly the auto-grow height:** They remain in manual mode for the rest of the draft. This is acceptable; "New Chat" or sending a message is the natural escape.
- **Disabled state during send:** No interaction with auto-grow; height is whatever it was when send started, which is fine.
- **Window resized smaller than current height:** Next keystroke (or window resize listener firing) clamps height to the new `40vh`.

## Testing

Manual verification against each behavior listed above:

1. Empty → type one line → no growth.
2. Type/paste enough to wrap → grows line by line.
3. Paste a 50-line block → grows to 40vh, then scrolls internally.
4. Resize browser window taller/shorter → cap follows viewport.
5. Manually drag handle to a custom size → keep typing → height stays at user's choice.
6. Send a message in auto-grow mode → returns to 60px.
7. Manually resize, send a message → returns to the manually chosen size.
8. Manually resize, click "New Chat" → returns to 60px, manual preference cleared.

No automated tests are added; this is a small UI behavior change with no existing test infrastructure for the component.
