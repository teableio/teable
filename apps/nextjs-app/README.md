# The web-app

You don't need start this app when developing locally, it's started by the `nestjs-backend`.

all env is maintained in the .env\* file, it is shared with the backend.

## Conditional lookup sort and limit

Enabling sort/limit leaves the limit blank: sorting alone must not add a numeric limit to
the saved options. Blank uses the configured conditional-query default cap; an explicit
limit updates the matching-record hint immediately. Disabling clears both sort and limit.
The shared conditional-rollup control follows the same interaction contract.

Run the focused interaction coverage with:

```sh
pnpm --filter @teable/app exec vitest run src/features/app/components/field-setting/options/LinkedRecordSortLimitConfig.spec.tsx
```

## Field editor save state

While a field save is pending, the field editor disables Save and Cancel and shows a spinner on
Save. The unsaved-changes confirmation uses the same pending state so it cannot submit the save
twice.

Run the focused interaction coverage with:

```sh
pnpm --filter @teable/app exec vitest run src/features/app/components/field-setting/FieldSetting.spec.tsx
```

## Kanban button previews

Visible button fields render on cards before their first click creates a stored value.
Empty ordinary fields and empty button lookups remain hidden. Button previews use the same
theme palette as grid and expanded-record buttons; clicking a preview still opens the card,
and running an automation remains an expanded-record action.

## Date-format preset regression coverage

Each date-format preset is a separate interaction case in `DatetimeFormatting.spec.tsx`.
All eleven choices retain their stored-format and selected-label assertions without sharing
one five-second deadline. Local/preset identity, time-format transitions and custom-format
reopening remain separate state-transition tests. Do not raise the default timeout or remove
presets to accommodate the parallel community-package CI job.

```sh
pnpm --filter @teable/app exec vitest run src/features/app/components/field-setting/formatting/DatetimeFormatting.spec.tsx
```

## Command palette

`Cmd+K` / `Ctrl+K` opens the shared project/space palette. The project context is fixed:
there is no scope selector or cross-table record search. On space pages, empty input shows
recently visited projects in the current space; inside a project it shows that project's
recent resources and exact recently visited views. Both appear beside permitted quick actions;
settings and appearance are available through search or `>` command mode, not the empty-state primary results.

Names match exact text, prefixes, word starts (including Chinese), substrings, pinyin and
initials before fuzzy matches. Recency and frequency break ties within those relevance tiers.
Space search keeps its previous rows visible during the 300 ms debounce and pending request.
Project-side view metadata and permissions use canonical queries: the sidebar is outside
the table page's view and permission providers. A stale cache must not delete a recent view.

Arrow keys select; Enter or Tab executes; modifier+Enter opens navigation in a new tab.
Escape goes back from a nested page/command mode before closing and returning focus.
IME confirmation does not execute. Current-table search hands off to the mounted search
control and never introduces a second record-search implementation.

Pasting an image or file into the palette closes it and hands the clipboard files plus any
typed text to the current project's composer as one draft insert; it never sends. Text paste,
search and IME input keep their normal behavior, and the header badge shows the project's
icon (or a generic resource icon) beside its name.

Focused coverage lives in `src/features/app/blocks/base/base-side-bar/CommandPalette*.spec.tsx`,
`usePalette*.spec.tsx`, `command-palette-utils.spec.ts`, and `palette-recent.spec.ts`.
