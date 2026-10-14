# Field Requirements E2E Tests

Requirement-driven e2e coverage for the field capability list in
`staging-field-requirements.md` (Teable 字段基础功能需求逆推清单, 研发评审稿).

This folder is the **traceability layer**: every spec file names the requirement
IDs it locks down, so a reviewer can answer "is F03 covered?" with a grep.

```bash
# Which tests assert requirement D04?
rg -l 'D04' community/packages/v2/e2e/src
```

Audit tracking (B02): `lastModifiedTime` and `lastModifiedBy` persist and return
`options.trackedFieldIds: []` for track-all, including creation without options.
Deleting a tracked field removes its ID from both persisted configurations,
preserves surviving tracked IDs, and returns to track-all when none remain.
Deletion cleanup preserves existing audit storage so undo/redo can restore the
original stamps, and publishes dependent-table refresh notifications after
persisting cleanup. Stored modification-time fields read the same physical stamp
directly and through lookup/rollup dependencies, including after delete/undo/redo.
History preservation is explicit for same-type option changes; type conversions
still initialize existing rows, including deferred number-to-modified-by conversion.
The system-field stamping matrix covers these boundaries, different-actor edits,
and cross-table notifications for single/batch deletion (T7786/Y2855, T7787/Y2857).

## Source of truth

The requirement worklist lives in Teable, not in this file:

| What                                      | Where                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Requirement list (§2–§8, 115 items)       | https://app.teable.ai/artifact/art44REDA6fQWlJYtHR                                           |
| Review worklist (one row per requirement) | https://app.teable.ai/base/bserJ2pmgiLHFHfXNwE/table/tblhjrcP0ZgLtKdbkIz/viwojUW1RQBOVPu3X4S |
| Test case table (all rows)                | https://app.teable.ai/base/bserJ2pmgiLHFHfXNwE/table/tblhjrcP0ZgLtKdbkIz                     |

### Two id schemes, and how they line up

| Id       | Who assigns it   | Shape               | Use it when                       |
| -------- | ---------------- | ------------------- | --------------------------------- |
| 需求编号 | the document     | `F01`, `D04`, `R10` | talking about a rule              |
| 本地编号 | this batch       | `FLD-F01`           | authoring, before the row exists  |
| 用例ID   | the Teable table | `Y2528`             | execution records, "跑一下 Y2553" |

`用例ID` is the table's own sequence (`"Y" & (AUTO_NUMBER() - offset)`, with
offsets and a few per-record overrides that keep previously issued numbers
stable across inserts and deletions). It therefore **cannot be derived** from
the requirement id, and the requirement id cannot be derived from it. The
mapping is recorded on both sides instead:

- on the row, `备注` carries `批次：FIELD-REQ-20261012；本地编号：FLD-<ID>。` followed by
  `用例ID：Y<n>。`, so one row shows all three;
- in the repo, `requirement-case-ids.json` maps each requirement id to its
  `caseId`, so `FLD-D04` → `Y2553` without opening Teable.

This batch happens to be contiguous (`Y2528`–`Y2642`, 115 rows in document
order) because it was created in one pass, but treat that as a coincidence: the
offset corrections in the table's formula exist precisely because manual
inserts and deletions have broken the run before.

### Keeping the three copies honest

The same fact is written down three times — the Teable worklist, the ids in the
code, and this README — and they drifted apart once during the review, so both
directions are now checked.

**Offline, in the normal test run.** `traceability.spec.ts` runs with the rest of
the suite (no credentials needed) and fails on:

| Check                                                                           | The mistake it caught                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| every id in `requirement-case-ids.json` appears in a test file                  | an id whose only evidence was a file that did not exist       |
| `knownNotAssertable` is exact                                                   | a requirement could be silenced by adding it to the allowlist |
| this README's coverage table covers exactly the snapshot's ids                  | a row added to one side only                                  |
| every `.ts` reference in this README resolves                                   | a citation left behind by a rename                            |
| the findings rows are numbered without gaps, and every `see finding N` resolves | a table edited in two places                                  |
| `caseId`/`caseSeq`/`section` are internally consistent                          | a row pasted into the wrong group                             |

`S17` is the only entry in `knownNotAssertable`, and the second check above means
that cannot stay true by accident: fixing S17 fails the check until it is removed
from the list.

**Online, on demand.** Refresh the snapshot from the table:

```bash
cd community/packages/v2/e2e
pnpm traceability:refresh   # rewrite requirement-case-ids.json from Teable
pnpm traceability:check     # fail if the snapshot is stale
```

Both need the `teable` CLI authenticated against the endpoint the worklist lives
on, so they are maintainer steps rather than CI steps. The refresh also refuses
to write when the worklist itself is inconsistent — a row missing its
`本地编号`, a duplicate id, or a `用例ID` that the row's own `备注` does not
record. The query it runs:

```sql
SELECT "__id" AS rid, "Dan_Xing_Wen_Ben" AS yid, "Yong_Li_Xu_Hao" AS seq,
       "Yong_Li_Biao_Ti" AS title, "Bei_Zhu" AS note
FROM "bserJ2pmgiLHFHfXNwE"."tblhjrcP0ZgLtKdbkIz"
WHERE "Bei_Zhu" LIKE '%FIELD-REQ-20261012%'
ORDER BY "Yong_Li_Xu_Hao"
```

Each row of the worklist is one requirement, carrying the review conclusion the
document asks for:

- `用例标题` — the rule, in one line
- `所属模块`, `用例类型`, `用例级别` — where it sits in the QA taxonomy
- `前置条件` / `测试步骤` / `预期结果` — how the rule is verified
- `实际结果` — what v2 actually does, including any gap recorded below
- `执行状态` — `通过` when a test asserts it, `未执行` / `阻塞` when it cannot be
  asserted yet
- `备注` — `唯一需求依据：<artifact>；条款 §<section> <ID>`, the batch marker
  `批次：FIELD-REQ-20261012；本地编号：FLD-<ID>`, and the assigned `用例ID：Y<n>`

Look a requirement up with the 条款 in the artifact or the `FLD-` local id in the
worklist. `所属模块` is `字段管理`, or `统计字段与条件统计字段` for the §7
statistic group.

The tables below are a **snapshot** of that worklist so the mapping is readable
in a diff; when the two disagree, the Teable row wins.

## Requirement taxonomy

The requirement document groups field behaviour into seven sections. The
directory names mirror them one-to-one:

| Directory         | Document section                    | Requirement IDs |
| ----------------- | ----------------------------------- | --------------- |
| `F-field-matrix/` | §2 全字段能力矩阵                   | `F01`–`F22`     |
| `D-defaults/`     | §3 默认值与自动值需求               | `D01`–`D19`     |
| `S-formatting/`   | §4 显示样式需求                     | `S01`–`S19`     |
| `C-formula/`      | §5 计算需求：公式与依赖             | `C01`–`C18`     |
| `R-relations/`    | §6 计算需求：关联、查找与汇总       | `R01`–`R13`     |
| `A-aggregation/`  | §7 计算需求：底部统计、分组与筛选   | `A01`–`A12`     |
| `B-system/`       | §8 系统字段、配置变更及表格基础交互 | `B01`–`B12`     |

## File naming

```
<requirement-ids>-<behaviour>.spec.ts
```

- Requirement IDs come first, uppercase, hyphen-joined when a file locks down
  several: `D-defaults/D07-D19-update-duplicate-isolation.spec.ts`.
- The behaviour suffix is lowercase kebab-case and describes the rule, not the
  endpoint: prefer `provided-vs-omitted` over `create-record`.
- `.matrix.spec.ts` marks a file whose cases are driven by an `it.each` table.
- Inside a file, the `describe` title repeats the requirement IDs, and each
  `it`/`test` title states the expected rule in one sentence.
- Prefer `it.each` / `describe.each` over copy-pasted cases whenever the
  dimension being varied is an enum (field type, styling enum, statistic
  function, relationship kind, entry point). The case table is the
  specification; the assertion body stays shared.

## Layout

```
src/
├── shared/
│   └── requirementTestUtils.ts          # shared by this tree and update-field/
├── field-requirements/                  # requirement contract layer
│   ├── README.md
│   ├── shared/
│   │   └── fieldTypes.ts                # the 22-type enum, §2 as one table
│   ├── A-aggregation/
│   │   ├── A01-statistic-availability.matrix.spec.ts
│   │   ├── A08-A10-denominators-and-groups.matrix.spec.ts
│   │   └── A11-A12-multivalue-and-convergence.matrix.spec.ts
│   ├── B-system/
│   │   ├── B01-B03-system-field-stamping.matrix.spec.ts
│   │   ├── B04-auto-number-sequence.matrix.spec.ts
│   │   └── B05-button-configuration.matrix.spec.ts
│   ├── C-formula/
│   │   ├── C02-registered-function-catalogue.matrix.spec.ts
│   │   ├── C05-C12-text-and-array-semantics.matrix.spec.ts
│   │   └── C09-C10-time-sensitive-functions.spec.ts
│   ├── D-defaults/
│   │   ├── D04-D05-provided-vs-omitted.matrix.spec.ts
│   │   ├── D06-add-field-backfill.matrix.spec.ts
│   │   ├── D07-D19-update-duplicate-isolation.spec.ts
│   │   ├── D08-D09-D13-default-value-fidelity.spec.ts
│   │   ├── D11-D12-select-default-validity.spec.ts
│   │   ├── D15-unresolvable-default-user.spec.ts
│   │   └── D18-creation-entry-point.matrix.spec.ts
│   ├── F-field-matrix/
│   │   ├── F-D16-default-capability.matrix.spec.ts
│   │   ├── F01-F02-F10-text-and-attachment-display.matrix.spec.ts
│   │   └── F11-F20-and-capability-matrix.spec.ts
│   ├── R-relations/
│   │   ├── R03-R10-empty-set-results.matrix.spec.ts
│   │   └── R06-R09-rollup-function-availability.matrix.spec.ts
│   └── S-formatting/
│       ├── S03-S04-S05-S07-number-formatting.matrix.spec.ts
│       ├── S06-S09-S15-S18-S19-display-contract.matrix.spec.ts
│       ├── S08-S16-multiplicity-and-result-type.matrix.spec.ts
│       ├── S11-S12-datetime-formatting.matrix.spec.ts
│       └── S14-rating-formatting.matrix.spec.ts
├── update-field/<fieldType>/            # operation surface, one dir per type
├── create-field/<fieldType>/
├── dependency-cascade/, undo-redo/, computed-matrix/
└── *.e2e.spec.ts                        # cross-cutting topic specs
```

## How the requirement IDs reach the operation-surface specs

This tree is the contract layer. The operation-surface specs carry the same IDs
so a reviewer can grep one identifier and see both layers:

- a `describe` title is prefixed with its requirement IDs,
  e.g. `describe('[D01][F03][S01][S02][S08] update-field: number property updates')`;
- the prefix mirrors the `条款` recorded on the Teable worklist row, so a file
  that stops being cited there loses its tag on the next audit;
- `rg "\[D04\]" community/packages/v2/e2e/src` lists every spec that locks D04
  down, contract and operation together.

## Where a requirement belongs

Two folders may seem to overlap. Use the intent to choose:

- `field-requirements/` — _behaviour contract_ asked for by the requirement
  document: which value wins, what is persisted, which function is legal.
- `create-field/`, `update-field/`, `undo-redo/`, `computed-matrix/` —
  _operation surface_ tests for the corresponding command, organised per field
  type.

When a requirement is already locked down by an operation-surface test, do not
strengthen it here. Record the pointer in the coverage table below instead.

## Recorded findings for the review

These are the answers the document asks the developer to confirm. Each one was
observed against the running v2 service and is asserted by the test named.

| #   | Requirement | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `B02`       | **Open gap.** `trackedFieldIds` is persisted and returned by the API but does not scope the modification stamp — any edit advances `lastModifiedTime`/`lastModifiedBy`. Recorded with `it.fails` in `B-system/B01-B03-system-field-stamping.matrix.spec.ts`; remove the marker when the behaviour lands.                                                                                                                                                                           |
| 2   | `R10`       | **Inconsistent empty-set results.** `countall`/`counta`/`count` → `0`; `sum`/`average` → `0`; `max`/`min` → `null`; `concatenate`/`array_join`/`array_unique`/`array_compact` → `null`; `and`/`or` → `null` but `xor` → `false`. No uniform rule can be derived.                                                                                                                                                                                                                   |
| 3   | `D04`       | **Inconsistent clear semantics.** An explicit `''` clears a text, checkbox or multi-select cell, but a single select rejects it with a validation error. An explicit `[]` and an explicit `false` both normalise to `null`.                                                                                                                                                                                                                                                        |
| 4   | `D13`       | A checkbox `defaultValue: false` and no configured default are indistinguishable on the record: both store `null`. The field configuration does retain the `false`.                                                                                                                                                                                                                                                                                                                |
| 5   | `D06`       | Only a **required** field with a valid default backfills existing rows; an optional field with a default does not. Changing a default never rewrites existing rows. Promoting an existing empty column to required is refused with `validation.field.required_existing_values`.                                                                                                                                                                                                    |
| 6   | `D10`       | A batch create stamps one shared `now` for every record in the batch; single creates each get their own.                                                                                                                                                                                                                                                                                                                                                                           |
| 7   | `D11`       | Select defaults are validated against the option **names** that already exist, so an option id is rejected and a rename cannot carry the new default in the same payload. The supported sequence is clear-default → rename → set-default.                                                                                                                                                                                                                                          |
| 8   | `D18`       | Defaults apply on single create, batch create, paste-new-row and import. They never apply on update, and `duplicateRecord` copies stored values instead of re-evaluating dynamic defaults.                                                                                                                                                                                                                                                                                         |
| 9   | `C02`       | The registry holds **83** functions. The document lists 81 and omits `SET_LOCALE` and `SET_TIMEZONE`; legacy aliases exist for `ARRAYJOIN`, `ARRAYUNIQUE`, `ARRAYFLATTEN`, `ARRAYCOMPACT`.                                                                                                                                                                                                                                                                                         |
| 10  | `C05`       | `LEN` counts code points (`LEN("🚀")` is 1, `LEN("中文")` is 2). `FIND` is 1-based and returns `0` when the needle is absent. `MID` is 1-based and clamps a `0` start to the first character.                                                                                                                                                                                                                                                                                      |
| 11  | `C12`       | `ARRAYUNIQUE` de-duplicates keeping first-seen order; `ARRAYFLATTEN` concatenates without de-duplicating.                                                                                                                                                                                                                                                                                                                                                                          |
| 12  | `C04`       | `ROUND` rounds halves away from zero (`ROUND(-2.5, 0)` is `-3`), `INT` floors rather than truncates (`INT(-2.5)` is `-3`), and `MOD` keeps the dividend sign (`MOD(-7, 3)` is `-1`).                                                                                                                                                                                                                                                                                               |
| 13  | `S03`       | Precision is bounded to `0–5` and rejects `2.5`; a number field created without a formatting block falls back to decimal with precision 2.                                                                                                                                                                                                                                                                                                                                         |
| 14  | `S14`       | Reducing a rating's `max` **clamps** stored values to the new maximum; changing `icon`/`color` leaves values alone.                                                                                                                                                                                                                                                                                                                                                                |
| 15  | `A01`       | See the matrix in `A-aggregation/A01-statistic-availability.matrix.spec.ts` for the exact per-type statistic set. Checkbox is the notable case: it offers only `count`, `checked`, `unChecked`, `percentChecked`, `percentUnChecked` — no `empty`/`filled`/`unique`.                                                                                                                                                                                                               |
| 16  | `A08`       | The denominator for every percentage is the record count. A zero-row table reports `0` for percentages and `null` for arithmetic aggregates.                                                                                                                                                                                                                                                                                                                                       |
| 17  | `R06`       | `max({values})`/`min({values})` are legal for both numeric and date targets; `sum`/`average` are numeric-only and `and`/`or`/`xor` are boolean-only.                                                                                                                                                                                                                                                                                                                               |
| 18  | `C03`       | Missing parameters and syntax errors are rejected with a message naming the function (`IF needs at least 3 params`, `LEN only allow 1 param`), so those sub-items hold. Two do not: a non-convertible **literal** is accepted (`SUM("not a number")` creates the field and then reads back empty, so the bad type never gets a located error), and the document's "多余参数源码注释允许忽略" is stale — extra parameters are rejected, which is the stricter and better behaviour. |
| 19  | `D15`       | An unresolvable default user is accepted and preserved on the field, contributes nothing to the record, and drops only its own entry from a multi-user default. No notification path is entered.                                                                                                                                                                                                                                                                                   |
| 20  | `B05`       | The button click limit is clearable with `maxCount: null`, like `workflow` next to it. It previously parsed as a plain optional, so the limit could be set but never removed.                                                                                                                                                                                                                                                                                                      |
| 21  | `N-16`      | Button click limits must be positive integers. Zero, negative and fractional updates are rejected without changing the saved limit. Disabling the limit sends `maxCount: null` and `resetCount: false`; re-enabling starts with reset disabled (T7768, T7769; Y2804–Y2806).                                                                                                                                                                                                        |

## Coverage table (snapshot of the Teable worklist)

Status legend: **covered** = the rule is asserted by an existing test;
**partial** = only some of the stated dimensions are asserted; **gap** = no
test asserts the rule.

### §2 全字段能力矩阵

| ID    | Rule                                                                  | Status  | Test                                                                                                                                                                     |
| ----- | --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `F01` | Single line text: text default, styles, URL auto-detect               | covered | `create-field/singleLineText/singleLineText.spec.ts`, `update-field/singleLineText/update-properties.spec.ts`, `F-field-matrix/F-D16-default-capability.matrix.spec.ts`  |
| `F02` | Long text: text default, plain/Markdown rendering mode                | covered | `update-field/longText/update-properties.spec.ts`, `F-field-matrix/F-D16-default-capability.matrix.spec.ts`                                                              |
| `F03` | Number: numeric default incl. `0`, decimal/percent/currency, bar/ring | covered | `update-field/number/update-properties.spec.ts`, `S-formatting/S03-S04-S05-S07-number-formatting.matrix.spec.ts`                                                         |
| `F04` | Date: `now` default only, format/time/timezone                        | covered | `update-field/date/update-properties.spec.ts`, `S-formatting/S11-S12-datetime-formatting.matrix.spec.ts`                                                                 |
| `F05` | Single select: option default, name + colour                          | covered | `update-field/singleSelect/update-properties.spec.ts`                                                                                                                    |
| `F06` | Multiple select: option-set default, multi-label                      | covered | `update-field/multipleSelect/update-properties.spec.ts`                                                                                                                  |
| `F07` | Checkbox: `true`/`false`/cleared default                              | covered | `update-field/checkbox/update-properties.spec.ts`, `D-defaults/D08-D09-D13-default-value-fidelity.spec.ts`                                                               |
| `F08` | Rating: no default, 8 icons / 3 colours / max 1–10                    | covered | `S-formatting/S14-rating-formatting.matrix.spec.ts`, `rating-typecast-domain.e2e.spec.ts`                                                                                |
| `F09` | User: explicit user or `me`, single/multiple                          | covered | `update-field/user/update-properties.spec.ts`, `D-defaults/D04-D05-provided-vs-omitted.matrix.spec.ts`                                                                   |
| `F10` | Attachment: no default, file info + size statistics                   | covered | `A-aggregation/A01-statistic-availability.matrix.spec.ts`, `update-field/attachment/update-properties.spec.ts`, `F-field-matrix/F-D16-default-capability.matrix.spec.ts` |
| `F11` | Link: no default, four relationship kinds                             | covered | `link-*.e2e.spec.ts`, `A-aggregation/A01-statistic-availability.matrix.spec.ts`                                                                                          |
| `F12` | Formula: derived value, functions/deps/errors/recalc                  | covered | `formula.e2e.spec.ts`, `C-formula/`                                                                                                                                      |
| `F13` | Rollup: derived from linked target field + 14 rollup functions        | covered | `rollup-*.e2e.spec.ts`, `R-relations/R06-R09-rollup-function-availability.matrix.spec.ts`                                                                                |
| `F14` | Conditional rollup: derived from condition-matched rows               | covered | `conditional-rollup-*.e2e.spec.ts`                                                                                                                                       |
| `F15` | Created time: system generated, not writable                          | covered | `F-field-matrix/F-D16-default-capability.matrix.spec.ts`, `B-system/B01-B03-system-field-stamping.matrix.spec.ts`                                                        |
| `F16` | Last modified time: system generated, tracked fields                  | covered | `B-system/B01-B03-system-field-stamping.matrix.spec.ts`                                                                                                                  |
| `F17` | Created by: system generated                                          | covered | `F-field-matrix/F-D16-default-capability.matrix.spec.ts`                                                                                                                 |
| `F18` | Last modified by: system generated, tracked fields                    | covered | `B-system/B01-B03-system-field-stamping.matrix.spec.ts`                                                                                                                  |
| `F19` | Auto number: `AUTO_NUMBER()`, allocation uniqueness                   | covered | `B-system/B04-auto-number-sequence.matrix.spec.ts`, `auto-number.e2e.spec.ts`                                                                                            |
| `F20` | Button: label/colour/click limit, no cell default                     | covered | `create-field/button/button.spec.ts`                                                                                                                                     |
| `F21` | Plain lookup reference                                                | covered | `lookup-*.e2e.spec.ts`                                                                                                                                                   |
| `F22` | Conditional lookup reference                                          | covered | `conditional-lookup.e2e.spec.ts`, `create-field/conditionalLookup/`, `update-field/conditionalLookup/`                                                                   |

### §3 默认值与自动值

| ID    | Rule                                                                        | Status  | Test                                                                                                                           |
| ----- | --------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `D01` | Default value can be set, saved, reopened, modified, cleared                | covered | `update-field/*/update-properties.spec.ts`, `update-field/clear-default-value.spec.ts`                                         |
| `D02` | Editing unrelated config keeps the default value                            | covered | `D-defaults/D07-D19-update-duplicate-isolation.spec.ts`                                                                        |
| `D03` | Clearing a default is persisted and never reused                            | covered | `update-field/clear-default-value.spec.ts`                                                                                     |
| `D04` | Omitted / `null` / `''` / `0` / `false` / `[]` are distinct                 | covered | `D-defaults/D04-D05-provided-vs-omitted.matrix.spec.ts` — see finding 3 for the select exception                               |
| `D05` | Default applies only on create; explicit valid input wins                   | covered | `D-defaults/D04-D05-provided-vs-omitted.matrix.spec.ts`                                                                        |
| `D06` | Backfill rules when adding a field / changing a default / enabling required | covered | `D-defaults/D06-add-field-backfill.matrix.spec.ts` — see finding 5                                                             |
| `D07` | Editing or clearing an existing record does not re-apply defaults           | covered | `D-defaults/D07-D19-update-duplicate-isolation.spec.ts`                                                                        |
| `D08` | Text default keeps CJK, symbols, internal spaces, newlines                  | covered | `D-defaults/D08-D09-D13-default-value-fidelity.spec.ts`                                                                        |
| `D09` | Number default supports `0`, negatives, decimals                            | covered | `D-defaults/D08-D09-D13-default-value-fidelity.spec.ts`                                                                        |
| `D10` | Date `now` is evaluated per record, not at config-save time                 | covered | `D-defaults/D04-D05-provided-vs-omitted.matrix.spec.ts`, `D-defaults/D18-creation-entry-point.matrix.spec.ts` — see finding 6  |
| `D11` | Select defaults must resolve to legal options                               | covered | `D-defaults/D11-D12-select-default-validity.spec.ts` — see finding 7                                                           |
| `D12` | Option rename/delete keeps the default valid or fails loudly                | covered | `update-field/option-preservation.matrix.spec.ts`, `D-defaults/D11-D12-select-default-validity.spec.ts`                        |
| `D13` | Checkbox `false` default vs no default; clearing persists                   | covered | `D-defaults/D08-D09-D13-default-value-fidelity.spec.ts` — see finding 4                                                        |
| `D14` | User `me` resolves against the creating actor                               | covered | `createRecord.e2e.spec.ts`, `D-defaults/D04-D05-provided-vs-omitted.matrix.spec.ts`                                            |
| `D15` | Unresolvable default user has a defined outcome                             | covered | — (known gap: no test asserts the deactivated/deleted/unauthorized default user) — see finding 19                              |
| `D16` | System/derived fields cannot take a writable default                        | covered | `F-field-matrix/F-D16-default-capability.matrix.spec.ts`                                                                       |
| `D17` | Default + required + unique interact legally and fail loudly                | covered | `D-defaults/D06-add-field-backfill.matrix.spec.ts`                                                                             |
| `D18` | Creation-entry matrix (single/batch/paste/import/duplicate)                 | covered | `D-defaults/D18-creation-entry-point.matrix.spec.ts` — see finding 8                                                           |
| `D19` | Delete/restore/undo/duplicate keep or re-evaluate defaults                  | covered | `D-defaults/D07-D19-update-duplicate-isolation.spec.ts` (duplicate covered; restore/undo still only exercised by `undo-redo/`) |

### §4 显示样式

| ID    | Rule                                                              | Status  | Test                                                                                                                                        |
| ----- | ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `S01` | Styles survive save, reopen and refresh                           | covered | `update-field/*/update-properties.spec.ts`                                                                                                  |
| `S02` | Formatting never rewrites the stored number/time                  | covered | `update-field/number/update-properties.spec.ts`                                                                                             |
| `S03` | Number precision range 0–5, fallback precision 2                  | covered | `S-formatting/S03-S04-S05-S07-number-formatting.matrix.spec.ts` — see finding 13                                                            |
| `S04` | Percent renders value × 100                                       | covered | `S-formatting/S03-S04-S05-S07-number-formatting.matrix.spec.ts` (stored raw value `0.125` is asserted; the rendered string is a UI concern) |
| `S05` | Currency uses the configured symbol and precision                 | covered | `S-formatting/S03-S04-S05-S07-number-formatting.matrix.spec.ts`                                                                             |
| `S06` | Rounding / huge / tiny / negative-zero display policy             | covered | `listRecords-sort-format.e2e.spec.ts`, `S-formatting/S03-S04-S05-S07-number-formatting.matrix.spec.ts` (`-0` normalises to `0`)             |
| `S07` | Bar/ring colour, showValue, `maxValue` reference                  | covered | `S-formatting/S03-S04-S05-S07-number-formatting.matrix.spec.ts`                                                                             |
| `S08` | Multi-value numbers use bar/line, never single-value ring         | covered | `update-field/number/update-properties.spec.ts`                                                                                             |
| `S09` | Email/phone actions, URL auto-detect, legacy URL config           | covered | `update-field/singleLineText/update-properties.spec.ts`                                                                                     |
| `S10` | Long text plain vs Markdown keeps one source value                | covered | `update-field/longText/update-properties.spec.ts`                                                                                           |
| `S11` | Date presets US/EU/Asian/ISO/YM/MD/Y/M/D + time modes             | covered | `S-formatting/S11-S12-datetime-formatting.matrix.spec.ts`                                                                                   |
| `S12` | Field timezone drives display; hiding time keeps the instant      | covered | `S-formatting/S11-S12-datetime-formatting.matrix.spec.ts`                                                                                   |
| `S13` | Option colour/name stay aligned across rename                     | covered | `update-field/select-option-record-action.spec.ts`                                                                                          |
| `S14` | Rating icon/colour/max config; max reduction policy               | covered | `S-formatting/S14-rating-formatting.matrix.spec.ts` — see finding 14                                                                        |
| `S15` | Default appearance boundaries for opaque field types              | covered | `update-field/{attachment,user,link}/update-properties.spec.ts`                                                                             |
| `S16` | Computed formatting follows the result type; stale config cleaned | covered | `update-field/<systemType>/update-properties.spec.ts`                                                                                       |
| `S17` | Same business value across grid/detail/form/share                 | gap     | —                                                                                                                                           |
| `S18` | Copy/paste/export return raw or formatted value predictably       | covered | `listRecords-sort-format.e2e.spec.ts`                                                                                                       |
| `S19` | Empty / error / computing states are distinguishable              | covered | `computed-*.e2e.spec.ts`                                                                                                                    |

### §5 公式与依赖

| ID    | Rule                                                           | Status  | Test                                                                                                                                                                                                                                                  |
| ----- | -------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C01` | Operator/function surface matches the editor list              | covered | `formula.e2e.spec.ts`                                                                                                                                                                                                                                 |
| `C02` | Every registered function has a defined input/output type      | covered | `C-formula/C02-registered-function-catalogue.matrix.spec.ts` — see finding 9                                                                                                                                                                          |
| `C03` | Missing/illegal params and syntax errors are locatable         | partial | `C-formula/C03-function-argument-errors.matrix.spec.ts` — see finding 18: a non-convertible **literal** is accepted (`SUM("not a number")`), and extra parameters are rejected with a good message, so the source comment the document cites is stale |
| `C04` | Numeric functions: rounding, signs, zero, domain, coercion     | covered | `formula.e2e.spec.ts`, `C-formula/C05-C12-text-and-array-semantics.matrix.spec.ts` — see finding 12                                                                                                                                                   |
| `C05` | Text functions: index base, not-found, case, CJK, regex        | covered | `C-formula/C05-C12-text-and-array-semantics.matrix.spec.ts` — see finding 10                                                                                                                                                                          |
| `C06` | Logical truthiness and coercion                                | covered | `C-formula/C05-C12-text-and-array-semantics.matrix.spec.ts`                                                                                                                                                                                           |
| `C07` | `BLANK` / `ERROR` / `IS_ERROR` split empty vs error            | covered | `C-formula/C05-C12-text-and-array-semantics.matrix.spec.ts`                                                                                                                                                                                           |
| `C08` | Date functions: timezone, units, month/year/leap boundaries    | covered | `formula.e2e.spec.ts`, `formula-workday-diff.e2e.spec.ts`                                                                                                                                                                                             |
| `C09` | `NOW`/`TODAY`/`FROMNOW`/`TONOW` refresh policy                 | covered | `formula-fromnow-tonow.e2e.spec.ts`                                                                                                                                                                                                                   |
| `C10` | Date format/parse functions and illegal dates                  | covered | `formula-datetime-format.e2e.spec.ts`                                                                                                                                                                                                                 |
| `C11` | `COUNTALL`/`COUNTA`/`COUNT` semantics for empty/0/false/`[]`   | covered | `C-formula/C05-C12-text-and-array-semantics.matrix.spec.ts`                                                                                                                                                                                           |
| `C12` | Array join/unique/flatten/compact ordering and separator rules | covered | `C-formula/C05-C12-text-and-array-semantics.matrix.spec.ts` — see finding 11                                                                                                                                                                          |
| `C13` | Dependency-ordered recomputation, multi-level convergence      | covered | `computed-convergence.e2e.spec.ts`, `computed-matrix/`                                                                                                                                                                                                |
| `C14` | Rename/delete/convert of a referenced field                    | covered | `computed-*.e2e.spec.ts`                                                                                                                                                                                                                              |
| `C15` | Direct, indirect and cross-table cycles are detected           | covered | `update-field/conditionalRollup/circular-dependency.spec.ts`                                                                                                                                                                                          |
| `C16` | Result type inference for scalar and array results             | covered | `formula-metadata-coercion.e2e.spec.ts`                                                                                                                                                                                                               |
| `C17` | Preview, stored, API, filter and sort use one semantics        | covered | `table-api-query-parity.e2e.spec.ts`                                                                                                                                                                                                                  |
| `C18` | No missed or stale results after bulk changes                  | covered | `computed-large-scale-timeout.e2e.spec.ts`, `computed-convergence.property.e2e.spec.ts`                                                                                                                                                               |

### §6 关联、查找与汇总

| ID    | Rule                                                                   | Status  | Test                                                                                                                               |
| ----- | ---------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `R01` | Relationship kind constrains single/multi                              | covered | `link-exclusivity-constraints.e2e.spec.ts`, `link-one-one-duplicate.e2e.spec.ts`                                                   |
| `R02` | Lookup follows the configured source field                             | covered | `lookup-field-behaviors.e2e.spec.ts`                                                                                               |
| `R03` | Lookup filter/dedup rules and first-seen ordering                      | covered | `lookup-unique.e2e.spec.ts`, `rollup-arrayunique-select-order.e2e.spec.ts`, `R-relations/R03-R10-empty-set-results.matrix.spec.ts` |
| `R04` | Conditional lookup/rollup select rows dynamically                      | covered | `conditional-lookup.e2e.spec.ts`, `computed-matrix/conditional.matrix.spec.ts`                                                     |
| `R05` | Filter → sort → limit → aggregate order                                | covered | `conditional-rollup-*.e2e.spec.ts`                                                                                                 |
| `R06` | Rollup function must match the target type                             | covered | `R-relations/R06-R09-rollup-function-availability.matrix.spec.ts` — see finding 17                                                 |
| `R07` | Base rollup set: countall/counta/count/join/unique/compact/concatenate | covered | `R-relations/R06-R09-rollup-function-availability.matrix.spec.ts`, `R-relations/R03-R10-empty-set-results.matrix.spec.ts`          |
| `R08` | Numeric rollup adds sum/average/max/min; date adds max/min             | covered | `R-relations/R06-R09-rollup-function-availability.matrix.spec.ts`                                                                  |
| `R09` | Boolean rollup adds and/or/xor; empty-set semantics                    | covered | `R-relations/R06-R09-rollup-function-availability.matrix.spec.ts`, `R-relations/R03-R10-empty-set-results.matrix.spec.ts`          |
| `R10` | Empty link / no match / all-null per-function results                  | covered | `R-relations/R03-R10-empty-set-results.matrix.spec.ts` — see finding 2                                                             |
| `R11` | Deleting link/source rows triggers correct recomputation               | covered | `delete-table-lookup-of-link.e2e.spec.ts`, `deleteRecords-with-links.e2e.spec.ts`                                                  |
| `R12` | Nested single/multi lookups and cross-table chains                     | covered | `lookup-nested-chain.e2e.spec.ts`, `computed-matrix/chain.matrix.spec.ts`                                                          |
| `R13` | Cross-base capability and permission boundary                          | covered | `create-field/*/cross-base.spec.ts`                                                                                                |

### §7 底部统计、分组与筛选

| ID    | Rule                                                             | Status  | Test                                                                                                                      |
| ----- | ---------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `A01` | Statistic menu depends on field/result type and multiplicity     | covered | `A-aggregation/A01-statistic-availability.matrix.spec.ts` — see finding 15                                                |
| `A02` | Text statistics: count, empty/filled, unique + percentages       | covered | `aggregate-records.e2e.spec.ts`                                                                                           |
| `A03` | Numeric adds sum/average/min/max                                 | covered | `aggregate-records.e2e.spec.ts`                                                                                           |
| `A04` | Date adds earliest/latest and day/month ranges                   | covered | `aggregate-records.e2e.spec.ts`                                                                                           |
| `A05` | Checkbox uses checked/unchecked instead of empty/filled          | covered | `A-aggregation/A01-statistic-availability.matrix.spec.ts`, `A-aggregation/A08-A10-denominators-and-groups.matrix.spec.ts` |
| `A06` | Attachment adds total size, drops unique                         | covered | `A-aggregation/A01-statistic-availability.matrix.spec.ts`                                                                 |
| `A07` | Link has no unique; single user has unique, multiple does not    | covered | `A-aggregation/A01-statistic-availability.matrix.spec.ts`                                                                 |
| `A08` | Empty/filled/unique denominators, no illegal values at zero rows | covered | `A-aggregation/A08-A10-denominators-and-groups.matrix.spec.ts` — see finding 16                                           |
| `A09` | Filter/search/group/collapse/permission scope the statistic      | covered | `aggregate-records.e2e.spec.ts`                                                                                           |
| `A10` | Group statistics are computed per group, not averaged            | covered | `A-aggregation/A08-A10-denominators-and-groups.matrix.spec.ts`                                                            |
| `A11` | Multi-value statistics count records or elements explicitly      | covered | `aggregate-records.e2e.spec.ts`                                                                                           |
| `A12` | Statistics converge after write/delete/undo/filter change        | covered | `aggregate-records.e2e.spec.ts`                                                                                           |

### §8 系统字段、配置变更与表格交互

| ID    | Rule                                                              | Status  | Test                                                                                                               |
| ----- | ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `B01` | Created time/by are stamped once and survive later edits          | covered | `B-system/B01-B03-system-field-stamping.matrix.spec.ts`                                                            |
| `B02` | Modified fields honour `trackedFieldIds`                          | gap     | `B-system/B01-B03-system-field-stamping.matrix.spec.ts` — see finding 1; the option round-trips but has no effect  |
| `B03` | No-op edits and config-only changes define metadata impact        | covered | `B-system/B01-B03-system-field-stamping.matrix.spec.ts` (no-op edits and field renames leave the stamps untouched) |
| `B04` | Auto number is unique under concurrency and bulk create           | covered | `B-system/B04-auto-number-sequence.matrix.spec.ts`                                                                 |
| `B05` | Button label/colour/click limit and action effects                | covered | `create-field/button/button.spec.ts` — see finding 20                                                              |
| `B06` | Type conversion migrates value, default, style, deps, constraints | covered | `update-field/*/conversion/`, `update-field/option-preservation.matrix.spec.ts`                                    |
| `B07` | Copy field/table/import/export keeps portable config              | covered | `duplicateField.e2e.spec.ts`, `duplicateTable.e2e.spec.ts`, `base-duplicate.e2e.spec.ts`                           |
| `B08` | Sort/filter/group use the business type, not the display format   | covered | `listRecords-sort-format.e2e.spec.ts`                                                                              |
| `B09` | Hiding, resizing and reordering columns keeps values and config   | covered | `listRecords-metadata.e2e.spec.ts`, `viewOperations.e2e.spec.ts`                                                   |
| `B10` | Cell/batch edit, paste, clear and undo share type validation      | covered | `paste.e2e.spec.ts`, `clear.e2e.spec.ts`, `undo-redo/`                                                             |
| `B11` | Refresh and multi-user edits converge on one explainable result   | covered | `realtimeShareDb.e2e.spec.ts`                                                                                      |
| `B12` | Read-only, field permission, form and share restrict editing      | partial | `form-submit-required-computed.e2e.spec.ts`                                                                        |

### Known gaps

Two rules cannot be observed from this harness:

- `S17` — the same business value rendered in grid, record detail, form and
  share pages. Rendering is a front-end contract; the backend can only assert
  that every read path returns the same stored value, which the
  `S06-S09-S15-S18-S19` spec does.

Two rules are only partly asserted:

- `B12` — read-only, field-permission and share-mode restrictions are covered
  for the form-submit path only
  (`form-submit-required-computed.e2e.spec.ts`). The permission matrix needs a
  fixture with several collaborators, which the shared e2e context does not
  provide.
- `S15` — a deleted _source table_ is covered by
  `delete-table-lookup-of-link.e2e.spec.ts`; a deleted source _record_ is covered
  by the display-contract spec through the unlink path.

### Statistic convergence on undo

`A12` asserts convergence for writes, deletes, in-place updates and group moves.
The undo/redo variants live in `undo-redo/`, which asserts the operation is
reverted but not every statistic family afterwards. Adding the statistic
re-check there is the follow-up if the review wants undo covered too.

## Running

```bash
cd community/packages/v2/e2e
pnpm vitest run src/field-requirements     # this tree only (~65s)
pnpm vitest run                            # the whole package
```

Everything in this tree runs on the in-memory PGlite database, so it needs no
container runtime.

### Pre-existing failures in the full suite

These are not caused by the requirement work and are listed so nobody chases
them:

- **19 spec files need a Postgres container** and fail with
  `Could not find a working container runtime strategy` when Docker is not
  running. They are the `computed-*` convergence/outbox and `rowOrder*`,
  `search-access-path-contract`, `importMemory`, `field-conversion-deadlock`,
  `rollup-arrayunique-select-order` families, plus
  `update-field/number/conversion/to-formula-text`.
- **`update-field/formula/update-properties.spec.ts` asserts a UTC-rendered
  datetime** while a formula field's default timezone follows the machine
  (`Asia/Singapore` here), so two `[V1 PARITY]` cases are off by the machine
  offset. This tree's own datetime cases avoid the trap by comparing
  UTC-normalised instants.
