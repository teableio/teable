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
