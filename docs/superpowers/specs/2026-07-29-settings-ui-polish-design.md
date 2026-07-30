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

The client currently has no icon library — every icon is a raw unicode glyph.
Eight distinct icons are imported after this change.

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

New, for update status states: `LoaderCircle`, `CircleArrowUp`, `CircleX`.
(`Loader2` is a deprecated alias of `LoaderCircle`; the canonical name is used.)

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
  direct child of the button. The `.refresh-btn__icon` rule is deleted.
  `.refresh-btn` already has `display: inline-flex; align-items: center;
  gap: 6px` and needs no change. (Corrected during implementation; the original
  spec wrongly said it gains them.)
- `.gear-btn` — already `inline-flex` with `align-items: center`; only its inert
  `font-size` is removed.
- `.settings-chevron` — its `font-size` and `display: inline-block` are both
  inert on an SVG and are removed. `color` stays (it feeds `currentColor`) and so
  does the `transition`, which drives the rotation.
- `.expand-btn.expanded` and `.settings-chevron.is-open` keep their
  `transform: rotate(90deg)`, which works unchanged on an SVG.

## 3. App Info row

`settings/AppInfoCard.tsx`. The stacked label/value row, button, and status block
collapse into a single line:

```
VERSION 0.3.1  ✓ Up to date                    [ Check for Updates ]
```

New `.settings-version-row`: `display: flex`, `align-items: center`, `gap: 10px`,
`flex-wrap: wrap`. The button is pushed right with `margin-left: auto` and holds
its size with `flex-shrink: 0; white-space: nowrap`.

The wrap and shrink guards are load-bearing, not cosmetic. `.ticket-panel` is
`width: 40%; min-width: 280px` and the Electron `BrowserWindow` sets no
`minWidth`, so a narrow window shrinks this row. Without them the button shrank
past its own text and then overflowed `.collapsible__inner`, which has
`overflow: hidden` — clipping it rather than scrolling. At a 683px window
(half a 1366px laptop screen) 56 of its 78px were clipped and it could not be
clicked at all. Neither guard suffices alone: without `flex-shrink: 0` the button
shrinks before it wraps, and without `flex-wrap` the shrink guard makes the
clipping worse. (Found by the final review; the original spec had only
`margin-left: auto`.)

`VERSION` keeps the existing `.settings-row__label` styling (uppercase, small,
muted). The version number sits immediately adjacent at `font-weight: 700`,
color `#e8e8f0`.

The status slot sits immediately right of the version number. Every state renders
inline:

| State | Icon | Text | Color |
| --- | --- | --- | --- |
| `checking` | `LoaderCircle`, spinning | Checking… | `#8888a0` |
| `up-to-date` | `CircleCheck` | Up to date | `#7ee2a0` |
| `downloading` | `LoaderCircle`, spinning | Downloading… | `#8888a0` |
| `ready` | `CircleArrowUp` | Update Available | `#e6c25a` |
| `error` | `CircleX` | Check failed | `#f5b7b1` |

The slot renders nothing before the first check. Colors reuse the existing
palette.

The `LoaderCircle` spin uses a local `@keyframes tc-spin` with a
`prefers-reduced-motion: reduce` opt-out, matching how `.collapsible` and
`.settings-chevron` already guard their transitions.

Below the row, unchanged:

- The amber `.update-available-banner`, carrying `Download` / `Restart to Update`.
- The red `.settings-error` box, so the full error message stays readable. The
  inline status span also carries the message as a `title` attribute.

The status span carries `role="status"` so a screen reader announces the result
when a check completes. The icon inside is `aria-hidden`; the label is real text.

`.settings-success` is no longer used by App Info, but the rule **stays** — it is
also used by the "Setup Complete" banner at `settings/JiraProjectCard.tsx:73`.
(Corrected during implementation; the original spec wrongly called it unused.)

## 4. Accordion spacing

`.settings-card__header { margin-bottom: 12px }` applies whether or not the
section is open. A collapsed card therefore carries 12px of header margin plus
14px of card padding — 26px of dead space below the title. This is the excess
bottom padding visible on closed sections.

Fix: set `.settings-card__header`'s `margin-bottom` to `0` and move the 12px onto
`.collapsible__inner` as `padding-top`, scoped to the open state:

```css
.collapsible__inner { overflow: hidden; min-height: 0; }
.collapsible.is-open > .collapsible__inner { padding-top: 12px; }
```

The `.is-open` scope is required. The original spec applied the `padding-top`
unconditionally, on the theory that inner padding contributes no height while the
grid row is `0fr`. That is false in Chromium: `0fr` resolves to the item's
*minimum* content size, and `min-height: 0` does not discount padding, so the
closed wrapper measured a full 12px tall. Unconditional padding therefore made
collapsed settings sections slightly *taller* (62px → 64px) instead of shorter,
and — because `.collapsible` is shared by `SpaceAccordion`, `TicketCard`, and
`EpicCard`, none of which had a header margin to offset — added a flat 12px to
every collapsed space accordion and ticket card in the app. Scoping to `.is-open`
yields the intended result: 52px collapsed, with the 12px gap preserved when open.
(Measured during the final review.)

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
none. The one new pure module (`update-status-view.js`) brings 8 unit tests of its
own, for 162 total.

Verification is `npm run build` for the typecheck (catches bad lucide imports and
prop types) plus a visual check of the running app: each accordion open and
closed, and the App Info row in its up-to-date, checking, and error states.
