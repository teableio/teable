Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/shared/sort Architecture Notes

## Responsibilities

- Sort field and direction modeling.
- Shared sorting contract for repositories.

## Record and view collation

Record-query and saved-view sort items accept `collation?: 'zh-pinyin'` alongside
`fieldId` and `order`. The option belongs to each sort item, not to the field or the
whole table. Omitting it preserves the existing ordering; opening or saving an
existing view must not opt it into pinyin ordering. Removing the option restores
the default behavior. Ascending/descending direction remains independent.

Explicit `zh-pinyin` is supported only for native single-line text, native long
text, and single-value Link fields. A Link is sorted by its displayed title, not
its record ID. Lookup, rollup and formula results are ineligible even if they
produce text; multiple-value links and all other field types are also ineligible.
An unsupported field or collation value is an error, never an ignored sort hint.

When `manualSort` is true, persisted sort items describe the order materialized into the View's
row-order storage and are dormant for automatic record ordering. Grouping by the same field as a
dormant pinyin sort is therefore valid; the same combination conflicts when automatic sorting is
active. Field eligibility is validated in both modes so manual materialization cannot retain an
unsupported pinyin collation.

V2 field-conversion side effects remove `zh-pinyin` from persisted view sort
items when the resulting field is no longer eligible, including link
multiplicity changes and foreign/symmetric field updates. The sort item,
direction, priority and manual-sort setting remain unchanged. Cleanup uses a
view-query-defaults update with previous defaults and the event-generating
table mutator, so persisted snapshots and the normal sort-update realtime
projection receive the same change. It does not rewrite record values.
Self-link symmetric updates reuse the current source aggregate, and subsequent
cleanup continues from the returned persisted table state and view versions.
Filter cleanup is applied to that aggregate before collation cleanup, preventing
a later full query-defaults update from restoring invalid filter conditions.
The cleanup updates both canonical and source filter representations, preserving
unrelated incomplete filter-editor conditions. `ViewFilterUpdated` therefore
carries the same source filter that snapshots, realtime documents and audit
consumers observe.

The repository applies the chosen order to the full filtered and authorized
result before pagination. Offset pages, record-index lookup and selection-range
operations must resolve the same ordering as the visible view. Copy, paste,
clear and delete must carry the collation through their range queries; sorting
only the rows already loaded in the client would target the wrong records.
Existing secondary sort rules, null handling and stable tie-breakers continue to
apply; pinyin sorting does not create a snapshot across concurrent record edits.

Pinyin ordering follows the database's ICU collation rules. It is not a
word-aware pronunciation or transliteration service: polyphonic characters may
not follow the reading intended for a person's name or phrase. Do not promise
dictionary-style disambiguation or a particular order for equivalent sort keys.
If the selected data database cannot provide the required ICU collation, the
request fails explicitly rather than reverting to default or client-side order.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe sort model.
- `Sort.spec.ts` - Role: tests; Purpose: verify sort composition and validation.
- `Sort.ts` - Role: sort model; Purpose: combine sort key and direction.
- `SortDirection.ts` - Role: value object; Purpose: validate sort direction.

## Examples

- `packages/v2/core/src/queries/ListTablesQuery.ts` - Sort construction.
