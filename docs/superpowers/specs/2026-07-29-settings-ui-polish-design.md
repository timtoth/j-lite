# Settings UI Polish — Design

Date: 2026-07-29
Branch: `feat/settings-ui-polish`
Version: 0.3.1 → 0.3.2

## Goal

Tighten up the Settings view: collapse the App Info block into one row, replace the
app's ad-hoc unicode glyphs with a real icon set, and fix accordion spacing and
header weight.

## 1. Add `lucide-react`

Add `lucide-react` to `client/package.json` dependencies. Vite tree-shakes named
imports, so only the icons actually used are bundled.

The client currently has no icon library — every icon is a raw unicode glyph. Ten
icons are imported after this change.

## 2. Icon conversions

All nine existing glyphs convert, plus three new update-status icons.

| Glyph | File | Lucide | Size | Purpose |
| --- | --- | --- | --- | --- |
| `▶` | `settings/SettingsSection.tsx` | `ChevronRight` | 15 | settings accordion toggle |
| `▶` | `settings/SpaceAccordion.tsx` | `ChevronRight` | 15 | space accordion toggle |
| `&#9654;` | `TicketCard.tsx` | `ChevronRight` | 14 | expand description |
| `&#9654;` | `EpicCard.tsx` | `ChevronRight` | 14 | expand child tickets |
| `↻` | `TicketPanel.tsx` | `RefreshCw` | 15 | Refresh button |
| `⚙` | `TicketPanel.tsx` | `Settings` | 16 | open Settings |
| `✓` | `settings/AppInfoCard.tsx` | `CircleCheck` | 15 | up-to-date status |
| `🗑` | `settings/SpaceAccordion.tsx:160` | `Trash2` | 15 | remove space |
| `🗑` | `settings/SpaceAccordion.tsx:228` | `Trash2` | 14 | remove custom field |

New, for update status states: `Loader2`, `CircleArrowUp`, `CircleX`.

`strokeWidth` is `2` everywhere except the chevrons, which use `2.25` — a
thin chevron reads as faint at 14–15px.

Icons inherit `currentColor`. This is the substantive fix for the two trash
buttons: `🗑` renders as a full-color Segoe UI Emoji glyph on Windows, so
`.space-accordion__remove`'s `color: #8b94a3` and its `:hover` → `#f5b7b1`
transition had no visible effect. An SVG honors both.

### CSS consequences

`font-size` no longer sizes these icons, so the rules that relied on it are
adjusted:

- `.expand-btn`, `.space-accordion__remove`, `.space-accordion__remove-field` —
  add `display: inline-flex; align-items: center; justify-content: center`.
  Their now-inert `font-size` declarations are removed.
- `.refresh-btn__icon` — the wrapper `<span>` is dropped; `<RefreshCw>` becomes a
  direct child of the button. `.refresh-btn` gains
  `display: inline-flex; align-items: center; gap: 6px`. The `.refresh-btn__icon`
  rule is deleted.
- `.gear-btn` — already `inline-flex` with `align-items: center`; only its inert
  `font-size` is removed.
- `.expand-btn.expanded` and `.settings-chevron.is-open` keep their
  `transform: rotate(90deg)`, which works unchanged on an SVG.

## 3. App Info row

`settings/AppInfoCard.tsx`. The stacked label/value row, button, and status block
collapse into a single line:

```
VERSION 0.3.1  ✓ Up to date                    [ Check for Updates ]
```

New `.settings-version-row`: `display: flex`, `align-items: center`, `gap: 10px`.
The button is pushed right with `margin-left: auto`.

`VERSION` keeps the existing `.settings-row__label` styling (uppercase, small,
muted). The version number sits immediately adjacent at `font-weight: 700`,
color `#e8e8f0`.

The status slot sits immediately right of the version number. Every state renders
inline:

| State | Icon | Text | Color |
| --- | --- | --- | --- |
| `checking` | `Loader2`, spinning | Checking… | `#8888a0` |
| `up-to-date` | `CircleCheck` | Up to date | `#7ee2a0` |
| `downloading` | `Loader2`, spinning | Downloading… | `#8888a0` |
| `ready` | `CircleArrowUp` | Update Available | `#e6c25a` |
| `error` | `CircleX` | Check failed | `#f5b7b1` |

The slot renders nothing before the first check. Colors reuse the existing
palette.

The `Loader2` spin uses a local `@keyframes tc-spin` with a
`prefers-reduced-motion: reduce` opt-out, matching how `.collapsible` and
`.settings-chevron` already guard their transitions.

Below the row, unchanged:

- The amber `.update-available-banner`, carrying `Download` / `Restart to Update`.
- The red `.settings-error` box, so the full error message stays readable. The
  inline `CircleX` also carries the message as a `title` attribute.

`.settings-success` becomes unused and is deleted.

## 4. Accordion spacing

`.settings-card__header { margin-bottom: 12px }` applies whether or not the
section is open. A collapsed card therefore carries 12px of header margin plus
14px of card padding — 26px of dead space below the title. This is the excess
bottom padding visible on closed sections.

Fix: set `.settings-card__header`'s `margin-bottom` to `0` and move the 12px onto
`.collapsible__inner` as `padding-top`, so the gap exists only when content is
expanded. `SpaceAccordion` shares `.collapsible` and gets the same fix.

The `.settings-card__header .settings-card__title { margin-bottom: 0 }` override
is unrelated to this and **stays** — it zeroes the *title's* margin, and it is
required because `.settings-card__title` is shared with a standalone heading (see
section 5).

## 5. Chevron gap and header size

`.settings-card__title` is a plain `h2` — the flex container is the wrapping
`.settings-card__title-btn`, and the chevron lives *inside* the `h2` alongside the
title text. So the `h2` itself needs `display: flex; align-items: center; gap: 10px`,
and the `{" "}` text node between chevron and title in `SettingsSection.tsx` is
removed.

`.space-accordion__title` is already `display: flex` with `gap: 8px`, and has no
`{" "}` to remove. Its gap goes to `10px`.

### Font size must be scoped

`.settings-card__title` is used in two places: the accordion `h2` in
`SettingsSection.tsx`, and a standalone "Spaces" `h3` in `JiraProjectCard.tsx:90`.
The latter is a sub-header inside the JIRA Project section and should not grow.

So the bump is applied to the existing scoped rule rather than the base rule:

```css
.settings-card__header .settings-card__title {
  margin-bottom: 0;   /* existing */
  font-size: 1.05rem; /* was 0.95rem from the base rule */
}
```

The base rule keeps `font-size: 0.95rem` and `margin-bottom: 12px` for the
"Spaces" heading. Adding `display: flex` to the base rule is harmless for that
`h3` (single text child, no layout change).

## 6. Version bump

Root `package.json`: `0.3.1` → `0.3.2`.

## Out of scope

- `••••` in `settings/JiraUserCard.tsx:22` — a masked-token placeholder, not an
  icon.
- `→` in `settings/JiraUserCard.tsx:64` — a breadcrumb inside prose
  ("id.atlassian.com → API tokens").

## Testing

The existing 154-test suite (`node --test`) covers server, config, and Electron
helper code — none of it touches the renderer, so no existing test should change
behavior. There is no renderer test harness in this repo and this change adds
none.

Verification is `npm run build` for the typecheck (catches bad lucide imports and
prop types) plus a visual check of the running app: each accordion open and
closed, and the App Info row in its up-to-date, checking, and error states.
