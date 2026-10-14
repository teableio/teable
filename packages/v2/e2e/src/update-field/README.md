# Update Field E2E Tests

This directory contains end-to-end tests for the `updateField` command in Teable v2.

## Directory Structure

One directory per field type, named exactly as `FieldType.fieldTypeValues` names
it, plus two shared buckets for behaviour that spans types:

```
update-field/
├── helpers.ts                     # Legacy helper bag; new specs use src/shared/requirementTestUtils.ts
├── README.md
├── <fieldType>/                   # one per registered field type
│   ├── update-properties.spec.ts  # name / options / default value / constraints
│   └── conversion/
│       └── to-<targetType>.spec.ts   # converting this type INTO <targetType>
├── dependency-cascade/            # crosses types: dependents recompute after a schema change
│   ├── cascade-after-schema-update.spec.ts
│   ├── dependency-cascade.spec.ts
│   ├── force-v2-all-regressions.spec.ts
│   ├── record-value-seeding.spec.ts
│   ├── schema-refresh-no-record-events.spec.ts
│   └── ai-trigger-guard.spec.ts
├── system-field-conversion/       # the 5 system types + 2 conditional types, both directions
│   └── conversion.spec.ts
└── <cross-cutting>.spec.ts        # event-shape, field-id-stability, option-preservation, …
```

The two buckets exist because their subject is not a field type:
`dependency-cascade/` is about what happens to _dependents_ when any field
changes, and `system-field-conversion/` covers seven field types symmetrically —
splitting it into `update-field/<type>/conversion/to-singleLineText.spec.ts` would
produce fourteen single-assertion files for one behaviour.

Every `describe` title is prefixed with the requirement IDs it locks down, e.g.
`describe('[D01][F03][S01][S02][S08] update-field: number property updates')`.
The mapping lives in `../field-requirements/README.md`.

## Storage-type conversion cascade

`dependency-cascade/cascade-after-schema-update.spec.ts` covers numeric-to-date
conversion with a same-table formula and a many-to-many rollup over the source.
The regression asserts timestamp values, computed storage/result types, default
date formatting, and removal of incompatible numeric display styles. Conversion
backfills use the existing deferred transaction queue so dependent metadata and
physical columns are updated before recomputation. The conservative
`skipDistinctFilter` flag must not suppress same-type lookup-retarget cascades.

## System-field value preservation

`system-field-conversion/conversion.spec.ts` covers created-time conversion to
text using the source date/time format and timezone, conversion to writable dates
without changing the UTC instant, and creator conversion to text without losing
names. Creator names containing commas remain quoted. Both legacy generated
creator-ID columns and stored creator snapshots are covered through the HTTP API.
Legacy timestamp-without-timezone values are interpreted as UTC before conversion;
month names and bracketed date-format literals are preserved. Physical creator
column types take precedence over stale generated-column metadata, and historical
snapshot names/IDs use the same fallback as record reads. Creator identity lookup
stays on the metadata database; tenant data statements only receive resolved values.

## V1 Parity Gaps

The following features exist in v1 but are **NOT YET IMPLEMENTED** in v2:

### 1. Text → Link Conversion (CRITICAL)

**V1 behavior**: Text values are matched against the primary field of the foreign table. Matches create links.

**V2 status**: Returns error "Cannot convert to link field type"

**Required implementation**:

- Load foreign table records
- Build name→recordId map from primary field
- Match text values (comma/newline separated) to create link cells
- Create junction table or FK column

**Reference**: `apps/nestjs-backend/src/features/field/field-calculate/field-converting-link.service.ts`

### 2. ~~Auto-Generate Select Options from Values~~ ✅ IMPLEMENTED

**V1 behavior**: When converting to SingleSelect/MultipleSelect, new options are automatically created from existing cell values with random colors.

**V2 status**: ✅ Implemented in `FieldTypeConversionVisitor.generateSelectOptionsFromValues()`

**Implementation details**:

- Uses SQL CTE to query distinct non-null, non-empty values from the column (cast to text)
- Generates choice objects with IDs like 'cho...' and colors from a predefined palette
- Merges new options with any existing choices
- Updates the field table's options column
- Works for all source types: Text, Number, Checkbox, Date → SingleSelect/MultipleSelect

### 3. Link Relationship Type Changes

**V1 behavior**: Can change between oneWay↔twoWay and manyMany↔oneMany relationships.

**V2 status**: Not implemented. UpdateLinkRelationshipSpec exists but schema changes not executed.

**Required implementation**:

- oneWay → twoWay: Create symmetric field in foreign table
- twoWay → oneWay: Delete symmetric field
- manyMany → oneMany: Migrate junction table to FK column (validate no multi-links)
- oneMany → manyMany: Migrate FK column to junction table

### 4. Link FROM Conversion

**V1 behavior**: Can convert link field to text (titles) or select (titles as options).

**V2 status**: Returns error "Cannot convert from link field"

**Required implementation**:

- Resolve linked record IDs to primary field values
- Join titles for multiple links
- Convert to target type

### 5. Select Option Modifications (Rename/Delete) → Record Updates

**V1 behavior**: When select options are renamed or deleted, all record values are updated accordingly.

**V2 status**: Not implemented. Option changes don't update record values.

**Required implementation**:

- `modifySelectOptions()`: Build updatedChoiceMap of old→new names
- When choice renamed: UPDATE table SET col = 'NewName' WHERE col = 'OldName'
- When choice deleted: UPDATE table SET col = NULL WHERE col = 'DeletedName'
- For MultipleSelect: Filter/map values in JSONB arrays

**Reference**: `field-converting.service.ts` → `modifySelectOptions()` method

### 6. Rating Max Reduction → Clamp Record Values

**V1 behavior**: When rating max is reduced, values exceeding the new max are clamped.

**V2 status**: Not implemented. Reducing max may leave invalid values.

**Required implementation**:

- `modifyRatingOptions()`: Find records with values > new max
- UPDATE table SET col = {newMax} WHERE col > {newMax}

**Reference**: `field-converting.service.ts` → `modifyRatingOptions()` method

### 7. User Field isMultiple Toggle → Convert Record Values

**V1 behavior**: Toggling isMultiple converts between single user and user arrays.

**V2 status**: Not implemented. isMultiple changes may leave incompatible values.

**Required implementation**:

- Single→Multi: UPDATE table SET col = jsonb_build_array(col) WHERE col IS NOT NULL
- Multi→Single: UPDATE table SET col = col->0 WHERE col IS NOT NULL

**Reference**: `field-converting.service.ts` → `modifyUserOptions()` method

### 8. Text → User Conversion

**V1 behavior**: Text values are matched against collaborator names/emails to find user IDs.

**V2 status**: Not implemented. Text→User conversion not supported.

**Required implementation**:

- Load table collaborators
- Build name/email→userId map
- Match text values to user IDs

**Reference**: `field-converting.service.ts` → `convert2User()` method

### 9. Computed Field Seeding After Field Update (CRITICAL GAP)

**V1 behavior**: After a field update, all dependent computed fields (formula, lookup, rollup) have their record values recalculated.

**V2 status**: Not implemented. Field metadata cascades work (`FieldUpdateSideEffectService` propagates cellValueType, hasError), but record value recomputation does not occur.

**Current state**:

- `FieldUpdateSideEffectService` cascades field metadata changes but does NOT trigger record value recomputation
- `TableSchemaUpdateVisitor` executes SQL for select option removal, rating clamping, user multiplicity — but no computed seed follows
- `PostgresTableSchemaRepository.update()` only runs `ComputedFieldBackfillService` for **new** fields, not existing field updates
- Missing link: no mechanism connects field updates to `PostgresTableRecordRepository.runComputedUpdate()`

**Decision**: Always seed when type changes (even text→select where DB values don't change), for safety since cellValueType changes may affect formula evaluation.

**Required implementation**:

- After field update completes schema changes, trigger `runComputedUpdate()` for all dependent computed fields
- For property changes (select option rename/delete, rating max reduction): seed only affected records
- For type conversions: seed all records of dependent computed fields

**Test coverage**: See `computed/dependency-cascade.spec.ts` (sections A-E) and `computed/record-value-seeding.spec.ts`

## Computed Dependency Cascade Test Categories

The `computed/dependency-cascade.spec.ts` file is organized into these sections:

### Existing (original)

- **Formula dependencies** — formula recomputation when referenced field converts
- **Lookup dependencies** — lookup metadata/value updates when target field converts
- **Rollup dependencies** — rollup recomputation when target field converts
- **Link conversion effects** — lookup/rollup error states when link field converts

### Section A: Targeted seeding for property changes (no type conversion)

- Select option rename/delete → affected records only
- Multiple select option delete → filter from arrays
- Rating max reduction → clamp affected records
- Cosmetic changes (icon, color) → no seed
- User field isMultiple toggle → wrap/unwrap values

### Section B: Type conversion computed seeds (all records)

- text→number, text→select, number→text, text→checkbox, text→date, date→number
- No seed for name-only, description-only, formatting-only changes

### Section C: Cross-table dependency seeds via link

- Lookup/rollup seeds when foreign field type converts
- Formula→lookup chain seeds
- Lookup seeds when foreign select option renamed/deleted
- Conditional lookup/rollup seeds when foreign field converts

### Section D: Formula compatibility after dependency field type change

- Formula hasError when referenced field converts to unsupported type
- Formula keeps working with compatible type conversion
- Formula chain recomputation (topological order)
- Date function breakage when date→text
- VALUE() identity when text→number

### Section E: Link field update triggers

- oneWay↔twoWay conversion seeds
- Link→non-link marks dependents as error
- Foreign table change marks dependents as error
- Relationship change (oneMany→manyOne) updates multiplicity

## Record Value Seeding Tests

The `computed/record-value-seeding.spec.ts` file verifies actual record cell values (not just metadata):

- **Property change value verification** — formula values after select rename/delete, lookup values after foreign option rename, rollup values after foreign type conversion, rating clamping effects on formula
- **Type conversion value verification** — formula recomputation after text→number, lookup recomputation after foreign text→number, null value preservation
- **Seeding optimization** — only affected records recomputed for property changes, all records for type changes, no records for cosmetic changes

**`/tables/updateField` endpoint**: NOT YET IMPLEMENTED

The `UpdateFieldCommand` and `UpdateFieldHandler` exist in v2-core, but the HTTP contract and express route are not yet added to `v2-contract-http` and `v2-contract-http-express`.

## Running Tests

Once the endpoint is implemented:

```bash
pnpm --filter @teable/v2-e2e test src/update-field/
```

## Test Conventions

1. **test.todo()**: Used for all tests until endpoint is implemented
2. **[NOT IMPLEMENTED]**: Prefix for tests requiring v2 implementation
3. **[V1 PARITY]**: Prefix for tests documenting v1 behavior that v2 should match
4. **Comments**: Each test.todo() includes detailed setup/action/assert comments

## Adding New Tests

1. Create test file in appropriate field type directory
2. Use `test.todo()` with detailed comments
3. Mark v1 parity gaps with `[NOT IMPLEMENTED]` or `[V1 PARITY]`
4. Reference v1 code paths in comments for implementation guidance
