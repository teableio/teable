import { describe, expect, it } from 'vitest';

import {
  CloneBaseVcsService,
  DiffBaseVcsService,
  GetBaseVcsStatusService,
  InMemoryLocalEngineAdapter,
  InMemoryVcsRemoteGateway,
  InMemoryVcsStateRepository,
  PullBaseVcsService,
  PushBaseVcsService,
  ResolveBaseVcsConflictsService,
  createV2VcsClientContainer,
} from '../client';
import {
  MAX_VCS_PATCH_RECORDS_PER_TABLE,
  adjustPatchAfterCommittedDeletes,
  applyIncrementalChanges,
  baseVcsPushRequestSchema,
  canRebasePatchCleanly,
  collectDeletedTableCasConflicts,
  collectTableFieldCasConflicts,
  collectTableRecordCasConflicts,
  collectTableViewCasConflicts,
  collectTouchedRecordIdsForBatchMutation,
  computeVcsTableScopeTag,
  decodeVcsPullCursor,
  diffComputedImpact,
  diffSnapshots,
  encodeVcsPullCursor,
  isComputedFieldType,
  isEmptyPatch,
  isStoredVcsField,
  isValidPgSnapshotText,
  normalizeRecordFields,
  patchToBaselineMutationBatch,
  planPatchBatches,
  resolveConflicts,
  summarizePatch,
  threeWayMerge,
  type IBaseVcsSnapshot,
  type IRecordVcsSnapshot,
  type IVcsDirtyKey,
} from '../index';

type DeepMutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

function mutableClone<T>(value: T): DeepMutable<T> {
  return structuredClone(value) as DeepMutable<T>;
}

function makeBaseSnapshot(overrides?: Partial<IBaseVcsSnapshot>): IBaseVcsSnapshot {
  return {
    formatVersion: 1,
    baseId: 'bseTest000000000001',
    baseName: 'Sales Base',
    revision: 1,
    capturedAt: '2026-11-15T00:00:00.000Z',
    tables: [
      {
        id: 'tblOrders0000000001',
        name: 'Orders',
        primaryFieldId: 'fldTitle00000000001',
        fields: [
          {
            id: 'fldTitle00000000001',
            name: 'Order Code',
            type: 'singleLineText',
            isPrimary: true,
            isComputed: false,
            unique: true,
            notNull: true,
          },
          {
            id: 'fldQty0000000000001',
            name: 'Qty',
            type: 'number',
            isPrimary: false,
            isComputed: false,
          },
          {
            id: 'fldStatus0000000001',
            name: 'Status',
            type: 'singleSelect',
            isPrimary: false,
            isComputed: false,
            options: {
              choices: [
                { id: 'choOpen', name: 'Open', color: 'blueBright' },
                { id: 'choPaid', name: 'Paid', color: 'greenBright' },
              ],
            },
          },
          {
            id: 'fldTags000000000001',
            name: 'Tags',
            type: 'multipleSelect',
            isPrimary: false,
            isComputed: false,
            options: {
              choices: [
                { id: 'choVip', name: 'VIP', color: 'purpleBright' },
                { id: 'choFast', name: 'Fast', color: 'orangeBright' },
                { id: 'choGift', name: 'Gift', color: 'pinkBright' },
              ],
            },
          },
          {
            id: 'fldTotal00000000001',
            name: 'Total',
            type: 'formula',
            isPrimary: false,
            isComputed: true,
            options: { expression: '{fldQty0000000000001} * 10' },
          },
        ],
        views: [
          {
            id: 'viwGrid000000000001',
            name: 'Grid view',
            type: 'grid',
            order: 0,
            columnMeta: {
              fldTitle00000000001: { order: 0, width: 180 },
              fldQty0000000000001: { order: 1, width: 120 },
            },
            query: {
              manualSort: false,
            },
          },
        ],
        records: [
          {
            id: 'rec0000000000000001',
            fields: {
              fldTitle00000000001: 'ORD-1',
              fldQty0000000000001: 2,
              fldStatus0000000001: 'Open',
              fldTags000000000001: ['VIP'],
              fldTotal00000000001: 20,
            },
          },
          {
            id: 'rec0000000000000002',
            fields: {
              fldTitle00000000001: 'ORD-2',
              fldQty0000000000001: 5,
              fldTotal00000000001: 50,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('domain: fieldClassification & diffSnapshots', () => {
  it('classifies computed vs stored fields and normalizes null/undefined/computed empties', () => {
    expect(isComputedFieldType('formula')).toBe(true);
    expect(isComputedFieldType('lookup')).toBe(true);
    expect(isComputedFieldType('conditionalLookup')).toBe(true);
    expect(isComputedFieldType('rollup')).toBe(true);
    expect(isComputedFieldType('conditionalRollup')).toBe(true);
    expect(isComputedFieldType('createdTime')).toBe(true);
    expect(isComputedFieldType('autoNumber')).toBe(true);
    expect(isComputedFieldType('number', true)).toBe(true);
    expect(isComputedFieldType('singleLineText', false, true)).toBe(true);
    expect(isComputedFieldType('singleLineText')).toBe(false);
    expect(isComputedFieldType('link')).toBe(false);

    const base = makeBaseSnapshot();
    const fields = base.tables[0].fields;
    expect(isStoredVcsField(fields[0])).toBe(true);
    expect(isStoredVcsField(fields[4])).toBe(false);

    const a = normalizeRecordFields({ fldTitle00000000001: 'A', fldTotal00000000001: 100 }, fields);
    const b = normalizeRecordFields(
      { fldTitle00000000001: 'A', fldQty0000000000001: null, fldStatus0000000001: undefined },
      fields
    );
    expect(a).toEqual({ fldTitle00000000001: 'A' });
    expect(a).toEqual(b);

    const cloneWithNulls = mutableClone(base);
    cloneWithNulls.tables[0].records[1] = {
      id: 'rec0000000000000002',
      fields: {
        fldTitle00000000001: 'ORD-2',
        fldQty0000000000001: 5,
        fldStatus0000000001: null,
        fldTags000000000001: undefined,
        fldTotal00000000001: 999,
      },
    };
    const patch = diffSnapshots(base, cloneWithNulls);
    expect(isEmptyPatch(patch)).toBe(true);
    expect(summarizePatch(patch).cellChanges).toBe(0);
  });

  it('respects accessScope by never reporting unreadable fields or filtered rows as deleted', () => {
    const before = makeBaseSnapshot();
    const after = mutableClone(
      makeBaseSnapshot({
        accessScope: {
          tables: {
            tblOrders0000000001: {
              tableId: 'tblOrders0000000001',
              readableFieldIds: ['fldTitle00000000001', 'fldQty0000000000001'],
              isRowFiltered: true,
            },
          },
        },
      })
    );
    // Simulate unreadable fields (fldStatus, fldTags) omitted and rec002 filtered out
    after.tables[0] = {
      ...after.tables[0],
      fields: after.tables[0].fields.filter(
        (f) => f.id !== 'fldStatus0000000001' && f.id !== 'fldTags000000000001'
      ),
      records: [
        {
          id: 'rec0000000000000001',
          fields: {
            fldTitle00000000001: 'ORD-1',
            fldQty0000000000001: 3, // real readable change
          },
        },
      ],
    };

    const patch = diffSnapshots(before, after);
    expect(patch.tablesUpdated).toHaveLength(1);
    const tblPatch = patch.tablesUpdated[0];
    expect(tblPatch.fieldsDeleted).toHaveLength(0);
    expect(tblPatch.recordsDeleted).toHaveLength(0);
    expect(tblPatch.recordsUpdated).toEqual([
      {
        recordId: 'rec0000000000000001',
        cellChanges: [{ fieldId: 'fldQty0000000000001', before: 2, after: 3 }],
      },
    ]);
  });

  it('computes diffComputedImpact for matching tables and records', () => {
    const before = makeBaseSnapshot();
    const after = makeBaseSnapshot();
    after.tables[0].records[0].fields.fldTotal00000000001 = 80;
    const impact = diffComputedImpact(before, after);
    expect(impact.totalAffectedCells).toBe(1);
    expect(impact.changes[0]).toMatchObject({
      tableId: 'tblOrders0000000001',
      recordId: 'rec0000000000000001',
      fieldId: 'fldTotal00000000001',
      before: 20,
      after: 80,
    });
  });

  it('requires before snapshots + version on deletes and flags live CAS version mismatches', () => {
    const base = makeBaseSnapshot();
    const fieldBefore = base.tables[0].fields[1];
    const viewBefore = base.tables[0].views[0];
    const recBefore = { ...base.tables[0].records[0], version: 1 };

    const missingBefore = baseVcsPushRequestSchema.safeParse({
      baseRevision: 1,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            tableId: base.tables[0].id,
            fieldsAdded: [],
            fieldsUpdated: [],
            fieldsDeleted: [{ fieldId: fieldBefore.id }],
            viewsAdded: [],
            viewsUpdated: [],
            viewsDeleted: [],
            recordsAdded: [],
            recordsUpdated: [],
            recordsDeleted: [],
          },
        ],
      },
    });
    expect(missingBefore.success).toBe(false);

    const fieldCas = collectTableFieldCasConflicts(
      base.tables[0].id,
      {
        tableId: base.tables[0].id,
        fieldsAdded: [],
        fieldsUpdated: [],
        fieldsDeleted: [{ fieldId: fieldBefore.id, before: fieldBefore }],
        viewsAdded: [],
        viewsUpdated: [],
        viewsDeleted: [],
        recordsAdded: [],
        recordsUpdated: [],
        recordsDeleted: [],
      },
      new Map([[fieldBefore.id, { ...fieldBefore, name: 'Modified Remotely' }]])
    );
    expect(fieldCas).toHaveLength(1);

    const viewCas = collectTableViewCasConflicts(
      base.tables[0].id,
      {
        tableId: base.tables[0].id,
        fieldsAdded: [],
        fieldsUpdated: [],
        fieldsDeleted: [],
        viewsAdded: [],
        viewsUpdated: [],
        viewsDeleted: [{ viewId: viewBefore.id, before: viewBefore }],
        recordsAdded: [],
        recordsUpdated: [],
        recordsDeleted: [],
      },
      new Map([[viewBefore.id, { ...viewBefore, name: 'Renamed Grid' }]])
    );
    expect(viewCas).toHaveLength(1);

    const recCas = collectTableRecordCasConflicts(
      base.tables[0].id,
      {
        tableId: base.tables[0].id,
        fieldsAdded: [],
        fieldsUpdated: [],
        fieldsDeleted: [],
        viewsAdded: [],
        viewsUpdated: [],
        viewsDeleted: [],
        recordsAdded: [],
        recordsUpdated: [],
        recordsDeleted: [{ recordId: recBefore.id, before: recBefore }],
      },
      new Map(base.tables[0].fields.map((f) => [f.id, f])),
      base.tables[0].fields,
      new Map([[recBefore.id, { ...recBefore, version: 3 }]])
    );
    expect(recCas).toHaveLength(1);
    expect(recCas[0]).toMatchObject({
      entityType: 'record',
      entityId: recBefore.id,
      before: { version: 1 },
      current: { version: 3 },
    });

    const missingTableBefore = baseVcsPushRequestSchema.safeParse({
      baseRevision: 1,
      patch: {
        tablesAdded: [],
        tablesDeleted: [{ tableId: base.tables[0].id, tableName: base.tables[0].name }],
        tablesUpdated: [],
      },
    });
    expect(missingTableBefore.success).toBe(false);

    const oversizedRecPatch = baseVcsPushRequestSchema.safeParse({
      baseRevision: 1,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            tableId: base.tables[0].id,
            fieldsAdded: [],
            fieldsUpdated: [],
            fieldsDeleted: [],
            viewsAdded: [],
            viewsUpdated: [],
            viewsDeleted: [],
            recordsAdded: Array.from({ length: MAX_VCS_PATCH_RECORDS_PER_TABLE + 1 }, (_, i) => ({
              id: `recOver${String(i)}`,
              fields: {},
            })),
            recordsUpdated: [],
            recordsDeleted: [],
          },
        ],
      },
    });
    expect(oversizedRecPatch.success).toBe(false);

    const diffDeleted = diffSnapshots(base, { ...base, tables: [] });
    expect(diffDeleted.tablesDeleted).toHaveLength(1);
    expect(diffDeleted.tablesDeleted[0]?.before.id).toBe(base.tables[0].id);

    const cleanDelCas = collectDeletedTableCasConflicts(
      diffDeleted.tablesDeleted[0]!,
      base.tables[0]
    );
    expect(cleanDelCas).toEqual([]);

    const dirtyLiveTable = mutableClone(base.tables[0]);
    dirtyLiveTable.name = 'Orders Renamed';
    dirtyLiveTable.fields.push({
      id: 'fldExtra00000000001',
      name: 'Extra',
      type: 'singleLineText',
      isPrimary: false,
      isComputed: false,
    });
    dirtyLiveTable.records.push({
      id: 'recExtra00000000001',
      fields: { fldTitle00000000001: 'New' },
    });
    const delCasConflicts = collectDeletedTableCasConflicts(
      diffDeleted.tablesDeleted[0]!,
      dirtyLiveTable
    );
    expect(delCasConflicts.map((c) => c.key)).toEqual(
      expect.arrayContaining([
        `${base.tables[0].id}:table:${base.tables[0].id}`,
        `${base.tables[0].id}:field:fldExtra00000000001`,
        `${base.tables[0].id}:record:recExtra00000000001`,
      ])
    );
  });

  it('encodes, validates, and decodes v2 scoped pg_snapshot cursors and legacy v1 cursors', () => {
    const scopeAll = computeVcsTableScopeTag();
    expect(scopeAll).toBe('all');
    const tagAB = computeVcsTableScopeTag(['tblB', 'tblA']);
    const tagBA = computeVcsTableScopeTag(['tblA', 'tblB', 'tblA']);
    expect(tagAB).toBe(tagBA);
    expect(tagAB).not.toBe('all');
    expect(tagAB).not.toBe(computeVcsTableScopeTag(['tblA']));

    expect(isValidPgSnapshotText('100:120:101,115')).toEqual({ xmin: '100', xmax: '120' });
    expect(isValidPgSnapshotText('120:100:')).toBeNull();
    expect(isValidPgSnapshotText('100:120:120')).toBeNull();
    expect(isValidPgSnapshotText('100:120:110,105')).toBeNull();
    expect(isValidPgSnapshotText('not-a-snapshot')).toBeNull();

    const encoded = encodeVcsPullCursor({
      v: 2,
      scopeTag: tagAB,
      maxSeq: 42,
      xmin: '100',
      snapshot: '100:120:105,112',
    });
    expect(encoded).toBe(`v2|${tagAB}|42|100:120:105,112`);
    expect(decodeVcsPullCursor(encoded)).toEqual({
      v: 2,
      scopeTag: tagAB,
      maxSeq: 42,
      xmin: '100',
      snapshot: '100:120:105,112',
    });

    expect(decodeVcsPullCursor('v1:100:5:')).toEqual({
      v: 2,
      scopeTag: 'legacy_v1',
      maxSeq: 5,
      xmin: '100',
      snapshot: '100:100:',
    });
    expect(decodeVcsPullCursor('v1:100:-1:')).toBeNull();
    expect(decodeVcsPullCursor('abc')).toBeNull();

    const pagedEncoded = encodeVcsPullCursor({
      v: 2,
      scopeTag: 'all',
      maxSeq: 100,
      xmin: '100',
      snapshot: '100:120:105',
      page: { targetSnapshot: '110:125:', afterSeq: 55 },
    });
    expect(pagedEncoded).toBe('v2|all|100|100:120:105|110:125:|55');
    expect(decodeVcsPullCursor(pagedEncoded)).toEqual({
      v: 2,
      scopeTag: 'all',
      maxSeq: 100,
      xmin: '100',
      snapshot: '100:120:105',
      page: { targetSnapshot: '110:125:', afterSeq: 55 },
    });
    expect(decodeVcsPullCursor('v2|all|100|100:120:|999:100:|55')).toBeNull();
  });
});

describe('domain: threeWayMerge & resolveConflicts', () => {
  it('merges disjoint edits, select choices by choice.id, view props, and set multiValueStrategy cleanly', () => {
    const base = makeBaseSnapshot();
    const ours = mutableClone(base);
    const theirs = mutableClone(base);

    // Disjoint cells on same record + multipleSelect set merge
    ours.tables[0].records[0].fields.fldQty0000000000001 = 10;
    ours.tables[0].records[0].fields.fldTags000000000001 = ['VIP', 'Fast'];

    theirs.tables[0].records[0].fields.fldStatus0000000001 = 'Paid';
    theirs.tables[0].records[0].fields.fldTags000000000001 = ['VIP', 'Gift'];

    // Algebraic select choices additions from both sides
    (ours.tables[0].fields[2].options!.choices as unknown[]).push({
      id: 'choOurs',
      name: 'OursChoice',
      color: 'cyanBright',
    });
    (theirs.tables[0].fields[2].options!.choices as unknown[]).push({
      id: 'choTheirs',
      name: 'TheirsChoice',
      color: 'yellowBright',
    });

    // Disjoint view edits (name vs filter)
    ours.tables[0].views[0].name = 'Sales Grid';
    theirs.tables[0].views[0].query = {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'fldQty0000000000001', operator: 'isGreater', value: 0 }],
      },
      manualSort: false,
    };

    const strictResult = threeWayMerge({
      base,
      ours,
      theirs,
      options: { multiValueStrategy: 'strict' },
    });
    expect(strictResult.conflicts.map((c) => c.kind)).toEqual(['cell_edit_edit']);
    expect(strictResult.conflicts[0].fieldId).toBe('fldTags000000000001');

    const setResult = threeWayMerge({ base, ours, theirs, options: { multiValueStrategy: 'set' } });
    expect(setResult.conflicts).toHaveLength(0);
    const mergedRec = setResult.mergedSnapshot.tables[0].records[0];
    expect(mergedRec.fields.fldQty0000000000001).toBe(10);
    expect(mergedRec.fields.fldStatus0000000001).toBe('Paid');
    expect(mergedRec.fields.fldTags000000000001).toEqual(['VIP', 'Fast', 'Gift']);

    const mergedChoices = setResult.mergedSnapshot.tables[0].fields[2].options!.choices as Array<{
      id: string;
    }>;
    expect(mergedChoices.map((c) => c.id)).toEqual(['choOpen', 'choPaid', 'choOurs', 'choTheirs']);
    expect(setResult.mergedSnapshot.tables[0].views[0].name).toBe('Sales Grid');
    expect(setResult.mergedSnapshot.tables[0].views[0].query?.filter).toBeDefined();
  });

  it('merges link array multiValueStrategy set cleanly', () => {
    const base = mutableClone(makeBaseSnapshot());
    base.tables[0].fields.push({
      id: 'fldLinks00000000001',
      name: 'Links',
      type: 'link',
      isPrimary: false,
      isComputed: false,
      options: { relationship: 'manyMany', foreignTableId: 'tblRef0000000000001' },
    });
    base.tables[0].records[0].fields.fldLinks00000000001 = [{ id: 'recL1' }, { id: 'recL2' }];

    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    // ours adds L3; theirs removes L2 and adds L4
    ours.tables[0].records[0].fields.fldLinks00000000001 = [
      { id: 'recL1' },
      { id: 'recL2' },
      { id: 'recL3' },
    ];
    theirs.tables[0].records[0].fields.fldLinks00000000001 = [{ id: 'recL1' }, { id: 'recL4' }];

    const res = threeWayMerge({ base, ours, theirs, options: { multiValueStrategy: 'set' } });
    expect(res.conflicts).toHaveLength(0);
    expect(res.mergedSnapshot.tables[0].records[0].fields.fldLinks00000000001).toEqual([
      { id: 'recL1' },
      { id: 'recL3' },
      { id: 'recL4' },
    ]);
  });

  it('emits field_delete_modify, record_delete_modify, and constraint_conflict and resolves all strategies', () => {
    const base = makeBaseSnapshot();
    const ours = mutableClone(base);
    const theirs = mutableClone(base);

    // 1. field_delete_modify: ours deletes fldStatus, theirs writes non-null cell into rec001.fldStatus
    ours.tables[0].fields = ours.tables[0].fields.filter((f) => f.id !== 'fldStatus0000000001');
    delete ours.tables[0].records[0].fields.fldStatus0000000001;
    theirs.tables[0].records[0].fields.fldStatus0000000001 = 'Paid';

    // 2. record_delete_modify: ours edits rec002.fldQty, theirs deletes rec002
    ours.tables[0].records[1].fields.fldQty0000000000001 = 99;
    theirs.tables[0].records = theirs.tables[0].records.filter(
      (r) => r.id !== 'rec0000000000000002'
    );

    // 3. unique constraint_conflict: ours & theirs both add different records with ORD-DUP on unique primary field
    ours.tables[0].records.push({
      id: 'recOursUnique000001',
      fields: { fldTitle00000000001: 'ORD-DUP' },
    });
    theirs.tables[0].records.push({
      id: 'recTheirsUnique0001',
      fields: { fldTitle00000000001: 'ORD-DUP' },
    });

    // 4. notNull constraint_conflict: theirs adds a record missing required fldTitle
    theirs.tables[0].records.push({
      id: 'recMissingNotNull01',
      fields: { fldQty0000000000001: 7 },
    });

    const mergeRes = threeWayMerge({ base, ours, theirs });
    const kinds = mergeRes.conflicts.map((c) => c.kind);
    expect(kinds).toContain('field_delete_modify');
    expect(kinds).toContain('record_delete_modify');
    expect(kinds).toContain('constraint_conflict');

    const uniqueConflict = mergeRes.conflicts.find((c) => c.id.startsWith('constraint:unique:'));
    const notNullConflict = mergeRes.conflicts.find((c) => c.id.startsWith('constraint:notNull:'));
    const fieldDelConflict = mergeRes.conflicts.find((c) => c.kind === 'field_delete_modify');
    const recDelConflict = mergeRes.conflicts.find((c) => c.kind === 'record_delete_modify');
    expect(uniqueConflict).toBeDefined();
    expect(notNullConflict).toBeDefined();
    expect(fieldDelConflict).toBeDefined();
    expect(recDelConflict).toBeDefined();

    // Partial resolution leaves remaining
    const partial = resolveConflicts({
      mergeState: {
        baseSnapshot: base,
        oursSnapshot: ours,
        theirsSnapshot: theirs,
        workingSnapshot: mergeRes.mergedSnapshot,
        conflicts: mergeRes.conflicts,
      },
      resolutions: {
        [uniqueConflict!.id]: { strategy: 'manual', manualValue: 'ORD-DUP-2' },
        [notNullConflict!.id]: { strategy: 'manual', manualValue: 'ORD-FIXED' },
      },
    });
    expect(partial.isOk()).toBe(true);
    const partialVal = partial._unsafeUnwrap();
    expect(partialVal.remainingConflicts).toHaveLength(2);

    const rest = resolveConflicts({
      mergeState: {
        baseSnapshot: base,
        oursSnapshot: ours,
        theirsSnapshot: theirs,
        workingSnapshot: partialVal.resolvedSnapshot,
        conflicts: partialVal.remainingConflicts,
      },
      resolutions: {
        [fieldDelConflict!.id]: { strategy: 'theirs' },
        [recDelConflict!.id]: { strategy: 'ours' },
      },
    });
    expect(rest.isOk()).toBe(true);
    expect(rest._unsafeUnwrap().remainingConflicts).toHaveLength(0);
    const finalRec = rest
      ._unsafeUnwrap()
      .resolvedSnapshot.tables[0].records.find((r) => r.id === 'recTheirsUnique0001');
    expect(finalRec?.fields.fldTitle00000000001).toBe('ORD-DUP-2');
  });
});

describe('domain: applyIncrementalChanges & fastForwardSafety', () => {
  it('reconstructs snapshot cleanly from incremental deltas', () => {
    const base = makeBaseSnapshot();
    const updatedTable = mutableClone(base.tables[0]);
    updatedTable.name = 'Orders v2';
    updatedTable.records = [];

    const next = applyIncrementalChanges(base, {
      baseId: base.baseId,
      baseName: 'Sales Base v2',
      fromRevision: 1,
      toRevision: 3,
      requiresFullSync: false,
      upsertedTables: [updatedTable],
      deletedTableIds: [],
      recordDeltas: [
        {
          tableId: 'tblOrders0000000001',
          upserts: [{ id: 'rec0000000000000003', fields: { fldTitle00000000001: 'ORD-3' } }],
          deletes: ['rec0000000000000002'],
        },
      ],
    });

    expect(next.revision).toBe(3);
    expect(next.baseName).toBe('Sales Base v2');
    expect(next.tables[0].name).toBe('Orders v2');
    expect(next.tables[0].records.map((r) => r.id)).toEqual([
      'rec0000000000000001',
      'rec0000000000000003',
    ]);
  });

  it('detects overlapping dirty keys and table/field schema overlaps on rebase check', () => {
    const base = makeBaseSnapshot();
    const edited = structuredClone(base);
    edited.tables[0].records[0].fields.fldQty0000000000001 = 77;
    const patch = diffSnapshots(base, edited);

    const disjointKeys: IVcsDirtyKey[] = [
      {
        revision: 2,
        tableId: 'tblOrders0000000001',
        entityType: 'record',
        entityId: 'rec0000000000000002',
        opKind: 'upsert',
      },
      {
        revision: 2,
        tableId: 'tblOrders0000000001',
        entityType: 'view',
        entityId: 'viwGrid000000000001',
        opKind: 'upsert',
      },
    ];
    expect(canRebasePatchCleanly(disjointKeys, patch)).toEqual({ ok: true });

    const sameRecKeys: IVcsDirtyKey[] = [
      {
        revision: 2,
        tableId: 'tblOrders0000000001',
        entityType: 'record',
        entityId: 'rec0000000000000001',
        opKind: 'upsert',
      },
    ];
    expect(canRebasePatchCleanly(sameRecKeys, patch)).toEqual({
      ok: false,
      overlappingKeys: ['tblOrders0000000001:record:rec0000000000000001'],
    });

    const disjointFieldKeys: IVcsDirtyKey[] = [
      {
        revision: 2,
        tableId: 'tblOrders0000000001',
        entityType: 'field',
        entityId: 'fldAddedElsewhere01',
        opKind: 'upsert',
      },
    ];
    expect(canRebasePatchCleanly(disjointFieldKeys, patch)).toEqual({ ok: true });

    const fieldSchemaKeys: IVcsDirtyKey[] = [
      {
        revision: 2,
        tableId: 'tblOrders0000000001',
        entityType: 'field',
        entityId: 'fldQty0000000000001',
        opKind: 'upsert',
      },
    ];
    expect(canRebasePatchCleanly(fieldSchemaKeys, patch).ok).toBe(false);

    const tableSchemaKeys: IVcsDirtyKey[] = [
      {
        revision: 2,
        tableId: 'tblOrders0000000001',
        entityType: 'table',
        entityId: 'tblOrders0000000001',
        opKind: 'upsert',
      },
    ];
    expect(canRebasePatchCleanly(tableSchemaKeys, patch).ok).toBe(false);
  });
});

describe('application: services end-to-end with in-memory adapters', () => {
  it('runs clone -> status -> diff (live + offline) -> push -> rebase/conflict -> pull -> resolve -> push lifecycle', async () => {
    const initial = makeBaseSnapshot();
    const remoteGateway = new InMemoryVcsRemoteGateway({ initialSnapshot: initial });
    const localEngine = new InMemoryLocalEngineAdapter();
    const stateRepository = new InMemoryVcsStateRepository();

    const container = createV2VcsClientContainer({
      remoteGateway,
      localEngine,
      stateRepository,
    });

    const cloneSvc = container.resolve(CloneBaseVcsService);
    const statusSvc = container.resolve(GetBaseVcsStatusService);
    const diffSvc = container.resolve(DiffBaseVcsService);
    const pullSvc = container.resolve(PullBaseVcsService);
    const resolveSvc = container.resolve(ResolveBaseVcsConflictsService);
    const pushSvc = container.resolve(PushBaseVcsService);

    const cloneRes = await cloneSvc.execute({ baseId: initial.baseId });
    expect(cloneRes.isOk()).toBe(true);

    const dupCloneRes = await cloneSvc.execute({ baseId: initial.baseId });
    expect(dupCloneRes.isErr()).toBe(true);
    expect(dupCloneRes._unsafeUnwrapErr().code).toBe('vcs.workspace_exists');

    const forceCloneRes = await cloneSvc.execute({ baseId: initial.baseId, force: true });
    expect(forceCloneRes.isOk()).toBe(true);

    expect((await statusSvc.execute({ checkRemote: true }))._unsafeUnwrap().hasChanges).toBe(false);

    // Local edit on rec001
    const working = (await localEngine.captureSnapshot(initial.baseId))._unsafeUnwrap();
    const localEdit = structuredClone(working);
    localEdit.tables[0].records[0].fields.fldQty0000000000001 = 42;
    await localEngine.hydrateSnapshot(localEdit);

    const offlineDiff = (await diffSvc.execute({ offline: true }))._unsafeUnwrap();
    expect(offlineDiff.target).toBe('base');
    expect(offlineDiff.summary.cellChanges).toBe(1);

    const liveDiffBeforeRemote = (await diffSvc.execute())._unsafeUnwrap();
    expect(liveDiffBeforeRemote.target).toBe('remote');
    expect(liveDiffBeforeRemote.summary.cellChanges).toBe(1);
    expect(liveDiffBeforeRemote.hasLocalChanges).toBe(true);
    expect(liveDiffBeforeRemote.hasRemoteChanges).toBe(false);

    // Concurrent disjoint edit on remote (rec002) -> live diff shows local & remote; push rebases cleanly!
    remoteGateway.applyServerMutation(initial.baseId, (cur) => {
      cur.tables[0].records[1].fields.fldQty0000000000001 = 88;
      return cur;
    });

    const liveDiffBothChanged = (await diffSvc.execute())._unsafeUnwrap();
    expect(liveDiffBothChanged.target).toBe('remote');
    expect(liveDiffBothChanged.remoteRevision).toBe(2);
    expect(liveDiffBothChanged.hasLocalChanges).toBe(true);
    expect(liveDiffBothChanged.hasRemoteChanges).toBe(true);
    expect(liveDiffBothChanged.conflicts).toHaveLength(0);

    const pushRebased = (await pushSvc.execute())._unsafeUnwrap();
    expect(pushRebased.ok).toBe(true);
    expect(pushRebased.rebased).toBe(true);
    expect(pushRebased.newRevision).toBe(3);
    // After rebased push, localEngine was synced with remote rec002 edit
    expect((await statusSvc.execute())._unsafeUnwrap().hasChanges).toBe(false);
    expect(
      (await localEngine.captureSnapshot(initial.baseId))._unsafeUnwrap().tables[0].records[1]
        .fields.fldQty0000000000001
    ).toBe(88);

    // Pull when already in sync should cleanly be a no-op
    const pullClean = (await pullSvc.execute())._unsafeUnwrap();
    expect(pullClean.conflicts).toHaveLength(0);
    expect(pullClean.workingSnapshot.tables[0].records[1].fields.fldQty0000000000001).toBe(88);

    // Conflicting edit on same cell (rec001.fldQty) -> push fails CAS -> pull conflicts -> resolve -> push succeeds
    remoteGateway.applyServerMutation(initial.baseId, (cur) => {
      cur.tables[0].records[0].fields.fldQty0000000000001 = 100;
      return cur;
    });
    const localConflict = structuredClone(pullClean.workingSnapshot);
    localConflict.tables[0].records[0].fields.fldQty0000000000001 = 200;
    await localEngine.hydrateSnapshot(localConflict);

    const pushCasFail = (await pushSvc.execute())._unsafeUnwrap();
    expect(pushCasFail.ok).toBe(false);
    expect(pushCasFail.conflictError?.code).toBe('vcs.cas_conflict');

    const pullConflict = (await pullSvc.execute())._unsafeUnwrap();
    expect(pullConflict.conflicts).toHaveLength(1);

    // Push must refuse while unresolved conflicts remain
    const blockedPush = await pushSvc.execute();
    expect(blockedPush.isErr()).toBe(true);
    expect(blockedPush._unsafeUnwrapErr().code).toBe('vcs.unresolved_conflicts');

    const resolved = (
      await resolveSvc.execute({
        resolutions: {
          [pullConflict.conflicts[0].id]: { strategy: 'manual', manualValue: 300 },
        },
      })
    )._unsafeUnwrap();
    expect(resolved.remainingConflicts).toHaveLength(0);

    const finalPush = (await pushSvc.execute())._unsafeUnwrap();
    expect(finalPush.ok).toBe(true);
    expect(
      remoteGateway.getSnapshot(initial.baseId)?.tables[0].records[0].fields.fldQty0000000000001
    ).toBe(300);
  });

  it('rejects push on openapi-readonly remote', async () => {
    const initial = makeBaseSnapshot();
    const remoteGateway = new InMemoryVcsRemoteGateway({
      initialSnapshot: initial,
      remoteMode: 'openapi-readonly',
    });
    const localEngine = new InMemoryLocalEngineAdapter();
    const stateRepository = new InMemoryVcsStateRepository();
    const container = createV2VcsClientContainer({ remoteGateway, localEngine, stateRepository });

    await container.resolve(CloneBaseVcsService).execute({ baseId: initial.baseId });
    const pushRes = await container.resolve(PushBaseVcsService).execute();
    expect(pushRes.isErr()).toBe(true);
    expect(pushRes._unsafeUnwrapErr().code).toBe('vcs.readonly_remote');
  });

  it('plans topological push batches and keeps reciprocal two-way link baselines synchronized', () => {
    const ordersTableId = 'tblOrdersBatch00001';
    const customersTableId = 'tblCustomersBatch01';
    const fldOrderTitle = 'fldOrderTitle000001';
    const fldCustName = 'fldCustName00000001';
    const fldOrderCustLink = 'fldOrderCust0000001'; // canonical (< sym)
    const fldCustOrdersSym = 'fldzCustOrdersSym001'; // non-canonical (> ord link)
    const fldUniqueCode = 'fldOrderCode0000001';

    const ordersSchema = {
      id: ordersTableId,
      name: 'Orders',
      primaryFieldId: fldOrderTitle,
      fields: [
        {
          id: fldOrderTitle,
          name: 'Title',
          type: 'singleLineText',
          isPrimary: true,
          isComputed: false,
        },
        {
          id: fldUniqueCode,
          name: 'Code',
          type: 'singleLineText',
          isPrimary: false,
          isComputed: false,
        },
        {
          id: fldOrderCustLink,
          name: 'Customer',
          type: 'link',
          isPrimary: false,
          isComputed: false,
          options: {
            relationship: 'manyOne',
            foreignTableId: customersTableId,
            symmetricFieldId: fldCustOrdersSym,
          },
        },
      ],
      views: [],
      records: [],
    };
    const customersSchema = {
      id: customersTableId,
      name: 'Customers',
      primaryFieldId: fldCustName,
      fields: [
        {
          id: fldCustName,
          name: 'Name',
          type: 'singleLineText',
          isPrimary: true,
          isComputed: false,
        },
        {
          id: fldCustOrdersSym,
          name: 'Orders',
          type: 'link',
          isPrimary: false,
          isComputed: false,
          options: {
            relationship: 'oneMany',
            foreignTableId: ordersTableId,
            symmetricFieldId: fldOrderCustLink,
          },
        },
      ],
      views: [],
      records: [],
    };

    const tableFieldsById = new Map([
      [ordersTableId, ordersSchema.fields],
      [customersTableId, customersSchema.fields],
    ]);

    const patch = {
      tablesAdded: [],
      tablesDeleted: [],
      tablesUpdated: [
        {
          tableId: ordersTableId,
          fieldsAdded: [],
          fieldsUpdated: [
            {
              fieldId: fldUniqueCode,
              before: ordersSchema.fields[1]!,
              after: { ...ordersSchema.fields[1]!, unique: true },
            },
          ],
          fieldsDeleted: [],
          viewsAdded: [],
          viewsUpdated: [],
          viewsDeleted: [],
          recordsAdded: [
            {
              id: 'recOrdNew0000000001',
              fields: {
                [fldOrderTitle]: 'New Order',
                [fldOrderCustLink]: { id: 'recCust200000000001', title: 'Globex' },
              },
            },
          ],
          recordsUpdated: [
            {
              recordId: 'recOrd1000000000001',
              cellChanges: [
                {
                  fieldId: fldOrderCustLink,
                  before: { id: 'recCust100000000001', title: 'Acme' },
                  after: { id: 'recCust200000000001', title: 'Globex' },
                },
              ],
            },
          ],
          recordsDeleted: [
            {
              recordId: 'recOrdDel0000000001',
              before: { id: 'recOrdDel0000000001', fields: { [fldOrderTitle]: 'Old' }, version: 1 },
            },
          ],
        },
        {
          tableId: customersTableId,
          fieldsAdded: [],
          fieldsUpdated: [],
          fieldsDeleted: [],
          viewsAdded: [],
          viewsUpdated: [],
          viewsDeleted: [],
          recordsAdded: [],
          recordsUpdated: [
            {
              recordId: 'recCust100000000001',
              cellChanges: [
                {
                  fieldId: fldCustOrdersSym,
                  before: [{ id: 'recOrd1000000000001', title: 'Ord 1' }],
                  after: null,
                },
              ],
            },
            {
              recordId: 'recCust200000000001',
              cellChanges: [
                {
                  fieldId: fldCustOrdersSym,
                  before: null,
                  after: [
                    { id: 'recOrd1000000000001', title: 'Ord 1' },
                    { id: 'recOrdNew0000000001', title: 'New Order' },
                  ],
                },
              ],
            },
          ],
          recordsDeleted: [],
        },
      ],
    };

    const batches = planPatchBatches(patch, { maxRecordOpsPerBatch: 1, tableFieldsById });
    // Stage breakdown: scalarAdd(1), delete(1), linkFinal(recOrdNew), linkFinal(recOrd1), constraint-tightening
    expect(batches.length).toBeGreaterThanOrEqual(4);
    expect(batches[0]?.tablesUpdated[0]?.recordsAdded).toHaveLength(1);
    expect(batches[0]?.tablesUpdated[0]?.recordsAdded[0]?.fields[fldOrderCustLink]).toBeUndefined();
    expect(batches[batches.length - 1]?.tablesUpdated[0]?.fieldsUpdated[0]?.after.unique).toBe(
      true
    );
    // Non-canonical symmetric link side (fldzCustOrdersSym001) omitted from batches to avoid CAS conflict
    for (const batch of batches) {
      for (const tp of batch.tablesUpdated) {
        if (tp.tableId === customersTableId) {
          expect(tp.recordsUpdated).toHaveLength(0);
        }
      }
    }

    // Verify reciprocal partner baseline sync updates both Cust1 and Cust2 without false version bumps
    const schemasMap = new Map([
      [ordersTableId, ordersSchema],
      [customersTableId, customersSchema],
    ]);
    const canonicalUpdateBatch = {
      tablesAdded: [],
      tablesDeleted: [],
      tablesUpdated: [
        {
          tableId: ordersTableId,
          fieldsAdded: [],
          fieldsUpdated: [],
          fieldsDeleted: [],
          viewsAdded: [],
          viewsUpdated: [],
          viewsDeleted: [],
          recordsAdded: [],
          recordsUpdated: [
            {
              recordId: 'recOrd1000000000001',
              cellChanges: [
                {
                  fieldId: fldOrderCustLink,
                  before: { id: 'recCust100000000001', title: 'Acme' },
                  after: { id: 'recCust200000000001', title: 'Globex' },
                },
              ],
            },
          ],
          recordsDeleted: [],
        },
      ],
    };
    const touched = collectTouchedRecordIdsForBatchMutation(canonicalUpdateBatch, schemasMap);
    expect(new Set(touched.get(customersTableId))).toEqual(
      new Set(['recCust100000000001', 'recCust200000000001'])
    );

    const baseRecords = new Map<string, Map<string, IRecordVcsSnapshot>>([
      [
        ordersTableId,
        new Map<string, IRecordVcsSnapshot>([
          [
            'recOrd1000000000001',
            {
              id: 'recOrd1000000000001',
              fields: {
                [fldOrderTitle]: 'Ord 1',
                [fldOrderCustLink]: { id: 'recCust100000000001' },
              },
              version: 3,
            },
          ],
        ]),
      ],
      [
        customersTableId,
        new Map<string, IRecordVcsSnapshot>([
          [
            'recCust100000000001',
            {
              id: 'recCust100000000001',
              fields: {
                [fldCustName]: 'Acme',
                [fldCustOrdersSym]: [{ id: 'recOrd1000000000001', title: 'Ord 1' }],
              },
              version: 2,
            },
          ],
          [
            'recCust200000000001',
            {
              id: 'recCust200000000001',
              fields: { [fldCustName]: 'Globex' },
              version: 5,
            },
          ],
        ]),
      ],
    ]);

    const mut = patchToBaselineMutationBatch(canonicalUpdateBatch, {
      newRevision: 10,
      existingTableSchemas: schemasMap,
      existingBaseRecordsByTable: baseRecords,
    });
    const custChange = mut.recordChanges.find((c) => c.tableId === customersTableId);
    const updatedCust1 = custChange?.upserts.find((r) => r.id === 'recCust100000000001');
    const updatedCust2 = custChange?.upserts.find((r) => r.id === 'recCust200000000001');
    expect(updatedCust1?.fields[fldCustOrdersSym]).toBeUndefined();
    expect(updatedCust1?.version).toBe(2);
    expect(updatedCust2?.fields[fldCustOrdersSym]).toEqual([
      { id: 'recOrd1000000000001', title: 'Ord 1' },
    ]);
    expect(updatedCust2?.version).toBe(5);

    // adjustPatchAfterCommittedDeletes strips already-deleted foreign IDs from later batches
    const adjusted = adjustPatchAfterCommittedDeletes(
      canonicalUpdateBatch,
      new Map([[customersTableId, new Set(['recCust100000000001'])]]),
      tableFieldsById
    );
    expect(adjusted.tablesUpdated[0]?.recordsUpdated[0]?.cellChanges[0]?.before).toBeNull();
  });
});
