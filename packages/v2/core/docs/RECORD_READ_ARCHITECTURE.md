# Record Read Architecture (Pure V2)

Declaration: If the folder I belong to changes, please update me.

## Goal

`GET /api/table/:tableId/record` (and get-by-id) must be a **pure V2 read stack**:

1. No V1 `RecordService` calls (`getSnapshotBulkWithPermission`, `getDocIdsByQuery` on the list path).
2. Handlers do **not** know authority-matrix. Permission enters as **generic scope**.
3. No outer-assembled permission view CTE (`view_cte_tmp` / raw `cteSql`) that the query repository depends on.
4. Tests first, including authority-matrix read cases.

## Current hybrid (to retire)

```
RecordOpenApiV2Service.getRecords
  ├─ EE getReadQuerySource → opaque CTE SQL + enabledFieldIds
  ├─ V2 ListTableRecords(projection: [])  → ordered ids (FROM view_cte_tmp)
  └─ V1 getSnapshotBulkWithPermission     → cell payload (wrapView CTE again)
```

Problems: dual CTE generation, SQL ownership inverted (upper layer builds FROM target), V1 payload path, handler half-encodes authz via `enabledFieldIds`.

## Target

```
OpenAPI adapter
  → RecordQueryPluginRunner.prepare / guard / getScope
  → ListTableRecordsQuery(options.queryScope)
  → ListTableRecordsHandler (AND recordSpec, intersect readableFieldIds)
  → TableRecordQueryRepository.find (physical table, stored mode)
  → map TableRecordReadModel → IRecordsVo  (V2 export)
```

Write path already uses `IRecordWritePlugin` + `RecordWritePluginScope`. Read mirrors that with `IRecordQueryPlugin` + `RecordQueryPluginScope`.

## Scope model

```ts
interface RecordQueryPluginScope {
  /** Row visibility: AND-ed into the query condition tree */
  recordSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
  /** Response projection allow-list; undefined = all fields; empty = no user fields */
  readableFieldIds?: ReadonlySet<string>;
  /**
   * Query + payload visibility (the v1 permission-CTE CASE contract).
   * May include fields outside readableFieldIds; those fields are query-only.
   */
  fieldMasks?: ReadonlyArray<{
    fieldId: string;
    visibleWhen: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
  }>;
}
```

| Authority effect       | Mechanism                                                                   |
| ---------------------- | --------------------------------------------------------------------------- |
| Table-level deny       | `guard()` fail → HTTP 403 (product default)                                 |
| Row filter             | `recordSpec` → WHERE                                                        |
| Static field deny      | projection exclusion + always-false `fieldMasks` (query value is NULL)      |
| Conditional field read | `fieldMasks` → filter polarity + sort/group CASE + search visibility guards |

## Invariants

1. Handlers never import authority-matrix or Nest permission services.
2. Repository never accepts raw permission SQL strings for reads (after cutover).
3. Scope is data (specs + field sets), not “rewrite FROM”.
4. Community: no plugin registered → unrestricted.
5. List remains **stored mode** (not computed).
6. **No V1 services on the pure record-read path** — not only `RecordService` /
   `getSnapshotBulk*`, but also `FieldService`, `AggregationService`,
   `RecordPermissionService`, and any other Nest V1 feature service.
   Field metadata comes from the **V2 `Table` aggregate** already loaded for the
   request (`table.getFields()`, `fieldIds()`, `getOrderedVisibleFieldIds`,
   domain field `formatting()` / type). Do **not** invent a `V2FieldService`
   that wraps V1; do not re-query field VOs for projection / filter meta /
   cell text formatting on this path.
7. Adversarial review of pure-V2 reads must **BLOCK** any new V1 call on
   `getRecords` / `getRecord` (and list handler). Residual hybrid only if
   explicitly listed under “Remaining gaps” (today: search-hit extra and the
   conditional-mask ShareDB compatibility fallback).

## Phased delivery

| Phase | Deliverable                                                                                   | Status |
| ----- | --------------------------------------------------------------------------------------------- | ------ |
| 0     | This doc + call-site inventory                                                                | done   |
| 1     | `IRecordQueryPlugin` + runner + DI                                                            | done   |
| 1b    | EE `getRecordReadPolicy` + record query plugin                                                | done   |
| 2     | Handler applies `queryScope` (AND `recordSpec`, field allow-list); CTE skipped when scope set | done   |
| 3     | Full payload from V2 list projection; no V1 snapshot bulk on getRecords                       | done   |
| 4     | `fieldMasks` applied post-read (domain `isSatisfiedBy` null-out)                              | done   |
| 5     | Prefer scope over `IRecordReadQuerySource` on list                                            | done   |
| 6     | Review hardenings: 403 getOne, empty allow-list, keepPrimary, DB masks, no FieldService       | done   |
| 6b    | Handler defaults projection to `readableFieldIds` when client projection omitted              | done   |
| 7a    | V2 group counts/headers/collapse from the same filter/search/permission scope                 | done   |
| 7b    | Pure search-hit `queryExtra` (no V1 `getDocIdsByQuery`)                                       | open   |
| 8     | EE authority e2e under V2 canary for pure getRecords/getRecord                                | done   |
| 8b    | ShareDB table query IDs + initial snapshots use V2 list/getByIds under the same canary        | done   |
| 9     | Mask-aware filter/sort/group/search SQL + static-deny always-false masks (T6997)              | done   |

**Merge gate:** Phases **0–6b + 8 + 9** closed.

- Pure list/get payload and masked query semantics: unit + EE canary e2e
  (`v2-record-read-mask.e2e-spec.ts`, `v2-authz-plugin.e2e-spec.ts`).
- Phase **7b** (search-hit `queryExtra`) remains a documented residual.

### Current pure path

OpenAPI V2 `getRecords` / `getRecord` and ShareDB table initial reads:

1. Load table aggregate
2. `RecordQueryPluginRunner.prepare` → `guard` → `getScope`
3. `ListTableRecordsQuery` with real projection + `queryScope` (no CTE when scope present);
   ShareDB query IDs use row-scoped `list`; snapshots use `getByIds` with host-controlled
   `keepPrimaryKey` for subscribed-document/version continuity, retaining non-primary field scope
   - Group counts and header points are aggregated by the V2 repository from the same composed
     record spec, search predicate, and configured group ordering. Collapsed headers are translated
     into a V2 exclusion filter and the visible page is queried again through the same scope.
   - When ShareDB requests group/search/order semantics over conditionally masked fields, a plugin
     may opt into `legacyPermissionQueryCompatible`. The legacy permission query supplies the
     mask-aware ordering/extras, then V2 revalidates every returned ID through the merged scope.
     The runner exports this capability only when every access-restricting plugin opts in.
4. Map `TableRecordReadModel` → `IRecord`; snapshots preserve the same read model's stored
   `version` as ShareDB `v`

### Authority parity notes

| Case                     | Behavior                                                      |
| ------------------------ | ------------------------------------------------------------- |
| Table deny               | plugin `guard` → 403                                          |
| Row filter (list)        | `recordSpec` AND into WHERE                                   |
| Row filter (getOne)      | empty under scope + exists without scope → **403** RESTRICTED |
| `filterLinkCellSelected` | `keepPrimaryKey` → `skipRecordSpec` + force primary field     |
| Static field deny        | response projection exclusion + always-false mask             |
| Conditional field        | mask-aware query SQL + post-read cell stripping               |

Remaining gaps (explicit hybrid residuals — do not grow this list without review):

- Search-hit `queryExtra` may still call V1 `getDocIdsByQuery`; normal list/count search and V2
  search-match projections apply field masks in SQL.
- selection and realtime operation delivery / subscription invalidation remain hybrid
- share-view ShareDB row reads still use the dedicated V1 share scope; initial record projection is
  intersected with the server-owned shared-field allow-list
- filter/sort side-channels on masked physical columns (prefer SQL CASE later)
- `CellFormat.Text` is value-shape display text (not full V1 `cellValue2String` formatting)

## Call-site inventory (read-adjacent)

### Pure-V2 getRecords path (done)

| Site                                       | Now                                                 |
| ------------------------------------------ | --------------------------------------------------- |
| `record-open-api-v2.service.ts#getRecords` | pure V2 list + plugin scope; no snapshot bulk       |
| `record-open-api-v2.service.ts#getRecord`  | V2 via selectedRecordIds                            |
| ShareDB table socket doc IDs               | V2 list scope; V2 branch bypasses V1 actor cache    |
| ShareDB table socket initial snapshots     | V2 getByIds; stored version + field-scoped payload  |
| EE authority matrix                        | `RecordQueryPlugin` injects filter/projection scope |

### Out of first cut (inventory only)

| Site                                             | Note                                  |
| ------------------------------------------------ | ------------------------------------- |
| `record.service.getRecords` (V1 engine)          | Keep until V1 retired                 |
| `selection.service` snapshot/docIds              | Separate migration                    |
| Share-view ShareDB row reads                     | Dedicated share-scope migration       |
| ShareDB per-subscriber realtime op redaction     | Separate transport/authz migration    |
| Stream delete / pre-read `recordReadQuerySource` | Follow-up; same scope model preferred |
| Write handlers that re-query with read source    | Follow-up                             |

## Related files

- Port: `ports/RecordQueryPlugin.ts`
- Runner: `application/services/RecordQueryPluginRunner.ts`
- Register: `di/registerRecordQueryPlugin.ts`
- List query: `queries/ListTableRecordsHandler.ts`
- Write analogue: `ports/RecordWritePlugin.ts`
