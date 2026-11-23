import { describe, expect, it } from 'vitest';

import * as v2Vcs from '../index';
import {
  canonicalizeSnapshot,
  diffSnapshots,
  type IBaseVcsSnapshot,
  type IVcsStoredChange,
} from '../index';

const makeR0Snapshot = (): IBaseVcsSnapshot =>
  canonicalizeSnapshot(
    {
      formatVersion: 1,
      baseId: 'bseRevTest000000001',
      baseName: 'Reverse Replay Base',
      revision: 1,
      capturedAt: '2026-11-16T00:00:00.000Z',
      tables: [
        {
          id: 'tblItems00000000001',
          name: 'Items',
          primaryFieldId: 'fldName000000000001',
          fields: [
            {
              id: 'fldName000000000001',
              name: 'Name',
              type: 'singleLineText',
              isPrimary: true,
              isComputed: false,
            },
            {
              id: 'fldQty0000000000001',
              name: 'Qty',
              type: 'number',
              isPrimary: false,
              isComputed: false,
            },
            {
              id: 'fldLegacy0000000001',
              name: 'Legacy',
              type: 'singleLineText',
              isPrimary: false,
              isComputed: false,
            },
          ],
          views: [
            {
              id: 'viwMain000000000001',
              name: 'Grid',
              type: 'grid',
              order: 0,
              columnMeta: {
                fldName000000000001: { order: 0 },
                fldQty0000000000001: { order: 1 },
                fldLegacy0000000001: { order: 2 },
              },
            },
            {
              id: 'viwOld0000000000001',
              name: 'Old Kanban',
              type: 'kanban',
              order: 1,
              columnMeta: {
                fldName000000000001: { order: 0 },
              },
            },
          ],
          records: [
            {
              id: 'recKeep000000000001',
              fields: {
                fldName000000000001: 'Sword',
                fldQty0000000000001: 10,
                fldLegacy0000000001: 'v1',
              },
            },
            {
              id: 'recGone000000000001',
              fields: {
                fldName000000000001: 'Shield',
                fldQty0000000000001: 5,
                fldLegacy0000000001: 'keep-me',
              },
            },
          ],
        },
      ],
    },
    { preserveComputed: true }
  );

const makeR1Snapshot = (): IBaseVcsSnapshot =>
  canonicalizeSnapshot(
    {
      formatVersion: 1,
      baseId: 'bseRevTest000000001',
      baseName: 'Reverse Replay Base',
      revision: 2,
      capturedAt: '2026-11-16T00:05:00.000Z',
      tables: [
        {
          id: 'tblItems00000000001',
          name: 'Items',
          primaryFieldId: 'fldName000000000001',
          fields: [
            {
              id: 'fldName000000000001',
              name: 'Name',
              type: 'singleLineText',
              isPrimary: true,
              isComputed: false,
            },
            {
              id: 'fldQty0000000000001',
              name: 'Quantity',
              type: 'number',
              isPrimary: false,
              isComputed: false,
              description: 'updated qty',
            },
            {
              id: 'fldTag0000000000001',
              name: 'Tag',
              type: 'singleLineText',
              isPrimary: false,
              isComputed: false,
            },
          ],
          views: [
            {
              id: 'viwMain000000000001',
              name: 'Main Grid',
              type: 'grid',
              order: 0,
              columnMeta: {
                fldName000000000001: { order: 0, width: 240 },
                fldQty0000000000001: { order: 1 },
                fldTag0000000000001: { order: 2 },
              },
            },
            {
              id: 'viwNew0000000000001',
              name: 'Compact Gallery',
              type: 'gallery',
              order: 1,
              columnMeta: {
                fldName000000000001: { order: 0 },
              },
            },
          ],
          records: [
            {
              id: 'recKeep000000000001',
              fields: {
                fldName000000000001: 'Sword',
                fldQty0000000000001: 42,
                fldTag0000000000001: 'rare',
              },
            },
            {
              id: 'recAdded00000000001',
              fields: {
                fldName000000000001: 'Potion',
                fldQty0000000000001: 99,
              },
            },
          ],
        },
      ],
    },
    { preserveComputed: true }
  );

describe('Base VCS reverse replay from before/after change rows (AC9)', () => {
  it('AC9: reconstructs the exact previous revision snapshot by reverse-replaying before values one step back', () => {
    const r0 = makeR0Snapshot();
    const r1 = makeR1Snapshot();

    const fldById = (snap: IBaseVcsSnapshot, id: string) =>
      snap.tables[0].fields.find((f) => f.id === id)!;
    const viewById = (snap: IBaseVcsSnapshot, id: string) =>
      snap.tables[0].views.find((v) => v.id === id)!;
    const recById = (snap: IBaseVcsSnapshot, id: string) =>
      snap.tables[0].records.find((r) => r.id === id)!;

    const r1Changes: IVcsStoredChange[] = [
      {
        seq: 101,
        txId: '500',
        baseId: r1.baseId,
        revision: 2,
        tableId: 'tblItems00000000001',
        entityType: 'field',
        entityId: 'fldQty0000000000001',
        opKind: 'update',
        beforeValue: fldById(r0, 'fldQty0000000000001'),
        afterValue: fldById(r1, 'fldQty0000000000001'),
        actorId: 'usrTester',
        createdAt: '2026-11-16T00:05:00.000Z',
      },
      {
        seq: 102,
        txId: '500',
        baseId: r1.baseId,
        revision: 2,
        tableId: 'tblItems00000000001',
        entityType: 'field',
        entityId: 'fldLegacy0000000001',
        opKind: 'delete',
        beforeValue: fldById(r0, 'fldLegacy0000000001'),
        afterValue: null,
        actorId: 'usrTester',
        createdAt: '2026-11-16T00:05:00.000Z',
      },
      {
        seq: 103,
        txId: '500',
        baseId: r1.baseId,
        revision: 2,
        tableId: 'tblItems00000000001',
        entityType: 'field',
        entityId: 'fldTag0000000000001',
        opKind: 'create',
        beforeValue: null,
        afterValue: fldById(r1, 'fldTag0000000000001'),
        actorId: 'usrTester',
        createdAt: '2026-11-16T00:05:00.000Z',
      },
      {
        seq: 104,
        txId: '500',
        baseId: r1.baseId,
        revision: 2,
        tableId: 'tblItems00000000001',
        entityType: 'view',
        entityId: 'viwMain000000000001',
        opKind: 'update',
        beforeValue: viewById(r0, 'viwMain000000000001'),
        afterValue: viewById(r1, 'viwMain000000000001'),
        actorId: 'usrTester',
        createdAt: '2026-11-16T00:05:00.000Z',
      },
      {
        seq: 105,
        txId: '500',
        baseId: r1.baseId,
        revision: 2,
        tableId: 'tblItems00000000001',
        entityType: 'view',
        entityId: 'viwOld0000000000001',
        opKind: 'delete',
        beforeValue: viewById(r0, 'viwOld0000000000001'),
        afterValue: null,
        actorId: 'usrTester',
        createdAt: '2026-11-16T00:05:00.000Z',
      },
      {
        seq: 106,
        txId: '500',
        baseId: r1.baseId,
        revision: 2,
        tableId: 'tblItems00000000001',
        entityType: 'view',
        entityId: 'viwNew0000000000001',
        opKind: 'create',
        beforeValue: null,
        afterValue: viewById(r1, 'viwNew0000000000001'),
        actorId: 'usrTester',
        createdAt: '2026-11-16T00:05:00.000Z',
      },
      {
        seq: 107,
        txId: '500',
        baseId: r1.baseId,
        revision: 2,
        tableId: 'tblItems00000000001',
        entityType: 'record',
        entityId: 'recKeep000000000001',
        opKind: 'update',
        beforeValue: {
          id: 'recKeep000000000001',
          fields: {
            fldQty0000000000001: 10,
            fldLegacy0000000001: 'v1',
            fldTag0000000000001: null,
          },
        },
        afterValue: {
          id: 'recKeep000000000001',
          fields: {
            fldQty0000000000001: 42,
            fldLegacy0000000001: null,
            fldTag0000000000001: 'rare',
          },
        },
        actorId: 'usrTester',
        createdAt: '2026-11-16T00:05:00.000Z',
      },
      {
        seq: 108,
        txId: '500',
        baseId: r1.baseId,
        revision: 2,
        tableId: 'tblItems00000000001',
        entityType: 'record',
        entityId: 'recGone000000000001',
        opKind: 'delete',
        beforeValue: recById(r0, 'recGone000000000001'),
        afterValue: null,
        actorId: 'usrTester',
        createdAt: '2026-11-16T00:05:00.000Z',
      },
      {
        seq: 109,
        txId: '500',
        baseId: r1.baseId,
        revision: 2,
        tableId: 'tblItems00000000001',
        entityType: 'record',
        entityId: 'recAdded00000000001',
        opKind: 'create',
        beforeValue: null,
        afterValue: recById(r1, 'recAdded00000000001'),
        actorId: 'usrTester',
        createdAt: '2026-11-16T00:05:00.000Z',
      },
    ];

    const applyReverseChangesOneStep = (
      v2Vcs as unknown as {
        applyReverseChangesOneStep: (
          snapshot: IBaseVcsSnapshot,
          changes: readonly IVcsStoredChange[],
          options?: { targetRevision?: number }
        ) => IBaseVcsSnapshot;
      }
    ).applyReverseChangesOneStep;

    expect(typeof applyReverseChangesOneStep).toBe('function');

    const reverted = applyReverseChangesOneStep(r1, r1Changes, { targetRevision: 1 });
    expect(diffSnapshots(r0, reverted)).toMatchObject({
      tablesAdded: [],
      tablesDeleted: [],
      tablesUpdated: [],
    });
    expect(reverted.tables).toEqual(r0.tables);
    expect(reverted.revision).toBe(1);
  });
});
