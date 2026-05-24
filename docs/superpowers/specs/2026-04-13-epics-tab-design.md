# Epics Tab Design

## Overview

Add tab navigation to the left panel of the ticket-control app with two tabs: "My Todo" (the existing ticket list, default) and "Epics" (new). The Epics tab shows JIRA Epics where the current user has involvement as assignee or reporter on child tickets. Epics expand inline to show all child tickets.

## Tab Navigation

- Tab bar at the top of the left panel (inside `TicketPanel`)
- Two tabs: **"My Todo"** (default/active), **"Epics"**
- Tab state managed with `useState` in `TicketPanel`
- Clicking a tab swaps the rendered content below
- Styled to match the existing panel aesthetic (same fonts, colors, borders)
- Left panel header updates to reflect the active tab

## Backend

### JIRA Query Strategy (Two-Query Approach)

Building the Epic list requires two sequential queries:

1. **Find user's tickets that belong to Epics:**
   - JQL: `(assignee = currentUser() OR reporter = currentUser()) AND "Epic Link" is not EMPTY AND status != Closed`
   - Extract unique Epic keys from the results

2. **Fetch Epic details** for each unique Epic key:
   - Retrieves: key, summary, status, url

3. **Fetch child tickets on demand** (when user expands an Epic):
   - JQL: `"Epic Link" = <EPIC-KEY>`
   - Fallback: `parent = <EPIC-KEY>` for next-gen JIRA projects if the first query returns no results
   - Returns all children regardless of assignee

### New API Endpoints (in `routes/epics.js`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/epics` | GET | Returns deduplicated list of Epics the user has involvement in |
| `/api/epics/:key/children` | GET | Returns all child tickets for a given Epic |

### New JIRA Functions (in `jira.js`)

- `getMyEpics()` — executes the two-query approach, returns Epic list
- `getEpicChildren(epicKey)` — fetches all child tickets of an Epic

## Frontend

### Modified Components

- **`TicketPanel.tsx`** — Tab bar added at top. Manages active tab state. Renders existing ticket list or EpicList based on active tab. Header text reflects active tab.

### New Components

- **`EpicList.tsx`** — Fetches Epics from `GET /api/epics` on mount. Uses same refresh pattern as ticket list (refreshKey prop). Renders list of `EpicCard` components.
- **`EpicCard.tsx`** — Displays Epic key, summary, and status badge (reusing `StatusBadge`). Clickable to expand/collapse. On expand, lazily fetches child tickets from `GET /api/epics/:key/children`. Renders children as nested rows showing key, title, status badge, and assignee.

### New Types (in `types.ts`)

```typescript
interface Epic {
  id: string;
  key: string;
  title: string;
  status: string;
  url: string;
}

interface EpicChild {
  id: string;
  key: string;
  title: string;
  status: string;
  url: string;
  assignee: string;
}
```

### New API Functions (in `api.ts`)

- `fetchEpics()` — calls `GET /api/epics`
- `fetchEpicChildren(key: string)` — calls `GET /api/epics/:key/children`

## Style

All new UI elements match the existing visual language: same fonts, colors, borders, card patterns, and StatusBadge reuse. No new design system or styling approach introduced.
