import { ViewOpBuilder } from '@teable/core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

const mockV2Tokens = vi.hoisted(() => ({
  v2DataDbTokens: {
    db: Symbol('v2.data.db'),
  },
  v2MetaDbTokens: {
    db: Symbol('v2.meta.db'),
  },
}));

vi.mock('@teable/v2-adapter-db-postgres-pg', () => ({
  v2DataDbTokens: mockV2Tokens.v2DataDbTokens,
  v2MetaDbTokens: mockV2Tokens.v2MetaDbTokens,
}));

vi.mock('./v2-container.service', () => ({
  V2ContainerService: class V2ContainerService {},
}));

vi.mock('./v2-view-compat.service', () => ({
  V2ViewCompatService: class V2ViewCompatService {},
}));

import { v2CoreTokens } from '@teable/v2-core';
import {
  V2FieldDeleteCompatCompletion,
  V2FieldDeleteSnapshotSink,
  V2FieldDeleteCompatService,
} from './v2-field-delete-compat.service';

const createInsertDb = () => {
  const query = {
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const db = {
    insertInto: vi.fn().mockReturnValue(query),
  };

  return { db, query };
};

const createReferenceDb = (
  references: ReadonlyArray<{ from_field_id: string; to_field_id: string }> = []
) => {
  const query = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(references),
  };
  const db = {
    selectFrom: vi.fn().mockReturnValue(query),
  };

  return { db, query };
};

const createV2ContainerService = (db: unknown, tableMapper: unknown) => ({
  getContainerForTable: vi.fn().mockResolvedValue({
    resolve: vi.fn((token: symbol) => {
      if (token === mockV2Tokens.v2DataDbTokens.db) {
        return db;
      }

      if (token === v2CoreTokens.tableMapper) {
        return tableMapper;
      }

      throw new Error(`Unexpected token ${String(token)}`);
    }),
  }),
});

const createRegistrationContainer = (input: {
  tableMapper: unknown;
  metaDb: unknown;
  dataDb: unknown;
}) => ({
  resolve: vi.fn((token: symbol) => {
    if (token === v2CoreTokens.tableMapper) {
      return input.tableMapper;
    }
    if (token === mockV2Tokens.v2MetaDbTokens.db) {
      return input.metaDb;
    }
    if (token === mockV2Tokens.v2DataDbTokens.db) {
      return input.dataDb;
    }
    throw new Error(`Unexpected token ${String(token)}`);
  }),
  registerInstance: vi.fn(),
});

const createTableMapper = () => ({
  toDTO: vi.fn().mockReturnValue(
    ok({
      id: 'tblCompatTable0001',
      baseId: 'bseCompatBase00001',
      name: 'Compat Table',
      primaryFieldId: 'fldCompatA00000001',
      fields: [
        {
          id: 'fldCompatA00000001',
          name: 'Text Field',
          type: 'singleLineText',
          dbFieldName: 'text_field',
          dbFieldType: 'text',
          isComputed: false,
        },
        {
          id: 'fldCompatB00000001',
          name: 'Number Field',
          type: 'number',
          dbFieldName: 'number_field',
          dbFieldType: 'number',
          isComputed: false,
        },
      ],
      views: [
        {
          id: 'viwCompat000000001',
          name: 'Grid',
          type: 'grid',
          options: { frozenFieldId: 'fldCompatA00000001' },
          columnMeta: {
            fldCompatA00000001: { order: 2, hidden: false },
            fldCompatB00000001: { order: 1, hidden: false },
          },
        },
      ],
    })
  ),
});

const createConditionalLookupTableMapper = () => ({
  toDTO: vi.fn().mockReturnValue(
    ok({
      id: 'tblCompatTable0001',
      baseId: 'bseCompatBase00001',
      name: 'Compat Table',
      primaryFieldId: 'fldPrimary000000001',
      fields: [
        {
          id: 'fldCondLookup000001',
          name: 'Conditional Lookup',
          type: 'conditionalLookup',
          dbFieldName: 'cond_lookup',
          dbFieldType: 'json',
          isComputed: true,
          isMultipleCellValue: true,
          innerType: 'number',
          innerOptions: { formatting: { type: 'decimal', precision: 2 } },
          options: {
            foreignTableId: 'tblForeign00000001',
            lookupFieldId: 'fldForeign00000001',
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
              },
              sort: { fieldId: 'fldScore0000000001', order: 'desc' },
              limit: 5,
            },
          },
        },
      ],
      views: [
        {
          id: 'viwCompat000000001',
          name: 'Grid',
          type: 'grid',
          options: {},
          columnMeta: {
            fldCondLookup000001: { order: 1, hidden: false },
          },
        },
      ],
    })
  ),
});

const createSnapshotItem = (fieldId: string, table: unknown = { kind: 'domainTable' }) => ({
  table,
  snapshot: {
    field: {
      id: fieldId,
      name: fieldId === 'fldCompatA00000001' ? 'Text Field' : 'Number Field',
      type: fieldId === 'fldCompatA00000001' ? 'singleLineText' : 'number',
      isPrimary: fieldId === 'fldCompatA00000001',
    },
    views: [
      {
        viewId: 'viwCompat000000001',
        columnMeta:
          fieldId === 'fldCompatA00000001'
            ? { order: 2, hidden: false }
            : { order: 1, hidden: false },
      },
    ],
    records: [{ recordId: 'recCompat000000001', value: `${fieldId}:value` }],
  },
});

describe('V2FieldDeleteSnapshotSink', () => {
  it('prepares an explicit completion with v2 delete snapshots, frozen view ops, and references', async () => {
    const tableMapper = createTableMapper();
    const { db, query } = createReferenceDb([
      {
        from_field_id: 'fldCompatA00000001',
        to_field_id: 'fldDependent0000001',
      },
    ]);
    const sink = new V2FieldDeleteSnapshotSink(
      tableMapper as never,
      db as never,
      createV2ContainerService(createInsertDb().db, tableMapper) as never,
      { batchUpdateViewByOps: vi.fn() } as never
    );
    const context = {
      actorId: { toString: () => 'usrCompatWriter00001' },
    };

    const result = await sink.prepare(context as never, {
      baseId: 'bseCompatBase00001',
      tableId: 'tblCompatTable0001',
      fieldIds: ['fldCompatA00000001', 'fldCompatB00000001'],
      snapshots: [
        createSnapshotItem('fldCompatA00000001'),
        createSnapshotItem('fldCompatB00000001'),
      ] as never,
    });

    expect(result._unsafeUnwrap()).toBeInstanceOf(V2FieldDeleteCompatCompletion);
    expect(db.selectFrom).toHaveBeenCalledWith('reference');
    expect(query.where).toHaveBeenCalledWith('from_field_id', 'in', [
      'fldCompatA00000001',
      'fldCompatB00000001',
    ]);
  });
});

describe('V2FieldDeleteCompatService', () => {
  it('registers the delete snapshot sink with the meta DB for reference reads', () => {
    const tableMapper = createTableMapper();
    const metaDb = createReferenceDb().db;
    const dataDb = createReferenceDb().db;
    const container = createRegistrationContainer({ tableMapper, metaDb, dataDb });
    const service = new V2FieldDeleteCompatService({} as never, {} as never);

    service.registerProjections(container as never);

    expect(container.resolve).toHaveBeenCalledWith(mockV2Tokens.v2MetaDbTokens.db);
    expect(container.resolve).not.toHaveBeenCalledWith(mockV2Tokens.v2DataDbTokens.db);
    expect(container.registerInstance).toHaveBeenCalledWith(
      v2CoreTokens.fieldDeleteSnapshotSink,
      expect.any(V2FieldDeleteSnapshotSink)
    );
  });
});

describe('V2FieldDeleteCompatCompletion', () => {
  it('keeps compat writes deferred until completion runs', () => {
    const { db, query } = createInsertDb();
    const tableMapper = createTableMapper();
    const v2ContainerService = createV2ContainerService(db, tableMapper);
    const v2ViewCompatService = {
      batchUpdateViewByOps: vi.fn(),
    };
    const completion = new V2FieldDeleteCompatCompletion(
      v2ContainerService as never,
      v2ViewCompatService as never,
      {
        tableId: 'tblCompatTable0001',
        userId: 'usrCompatWriter00001',
        operationId: 'opCompatDelete000001',
        frozenFieldOps: {},
        snapshots: [createSnapshotItem('fldCompatA00000001')],
        referencesByFieldId: new Map([['fldCompatA00000001', ['fldDependent0000001']]]),
      }
    );

    expect(completion).toBeDefined();
    expect(v2ContainerService.getContainerForTable).not.toHaveBeenCalled();
    expect(v2ViewCompatService.batchUpdateViewByOps).not.toHaveBeenCalled();
    expect(db.insertInto).not.toHaveBeenCalled();
    expect(query.values).not.toHaveBeenCalled();
  });

  it('uses v2 view compat and table_trash writes when completion runs', async () => {
    const { db, query } = createInsertDb();
    const tableMapper = createTableMapper();
    const v2ViewCompatService = {
      batchUpdateViewByOps: vi.fn().mockResolvedValue(undefined),
    };
    const frozenFieldOps = {
      viwCompat000000001: [
        ViewOpBuilder.editor.setViewProperty.build({
          key: 'options',
          oldValue: { frozenFieldId: 'fldCompatA00000001' },
          newValue: { frozenFieldId: 'fldCompatB00000001' },
        }),
      ],
    };
    const completion = new V2FieldDeleteCompatCompletion(
      createV2ContainerService(db, tableMapper) as never,
      v2ViewCompatService as never,
      {
        tableId: 'tblCompatTable0001',
        userId: 'usrCompatWriter00001',
        operationId: 'opCompatDelete000001',
        frozenFieldOps,
        snapshots: [createSnapshotItem('fldCompatA00000001')],
        referencesByFieldId: new Map([['fldCompatA00000001', ['fldDependent0000001']]]),
      }
    );

    const executionContext = {} as never;

    const result = await completion.complete(executionContext);

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(v2ViewCompatService.batchUpdateViewByOps).toHaveBeenCalledWith(
      'tblCompatTable0001',
      frozenFieldOps,
      executionContext
    );
    expect(db.insertInto).toHaveBeenCalledWith('table_trash');
    expect(query.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'opCompatDelete000001',
        table_id: 'tblCompatTable0001',
        created_by: 'usrCompatWriter00001',
        resource_type: 'field',
      })
    );
    const insertPayload = query.values.mock.calls[0]?.[0] as { snapshot: string };
    expect(JSON.parse(insertPayload.snapshot)).toEqual({
      fields: [
        expect.objectContaining({
          id: 'fldCompatA00000001',
          name: 'Text Field',
          type: 'singleLineText',
          references: ['fldCompatA00000001', 'fldDependent0000001'],
          columnMeta: {
            viwCompat000000001: { order: 2, hidden: false },
          },
        }),
      ],
      records: [
        {
          id: 'recCompat000000001',
          fields: {
            fldCompatA00000001: 'fldCompatA00000001:value',
          },
        },
      ],
    });
    expect(query.execute).toHaveBeenCalledTimes(1);
  });

  it('reuses the table DTO while building legacy payloads for bulk field deletes', async () => {
    const { db, query } = createInsertDb();
    const tableMapper = createTableMapper();
    const table = { kind: 'domainTable' };
    const completion = new V2FieldDeleteCompatCompletion(
      createV2ContainerService(db, tableMapper) as never,
      {
        batchUpdateViewByOps: vi.fn(),
      } as never,
      {
        tableId: 'tblCompatTable0001',
        userId: 'usrCompatWriter00001',
        operationId: 'opCompatDelete000002',
        frozenFieldOps: {},
        snapshots: [
          createSnapshotItem('fldCompatA00000001', table),
          createSnapshotItem('fldCompatB00000001', table),
        ],
        referencesByFieldId: new Map<string, ReadonlyArray<string>>(),
      }
    );

    const result = await completion.complete({} as never);

    expect(result._unsafeUnwrap()).toBeUndefined();
    expect(tableMapper.toDTO).toHaveBeenCalledTimes(1);

    const insertPayload = query.values.mock.calls[0]?.[0] as { snapshot: string };
    const snapshot = JSON.parse(insertPayload.snapshot);
    expect(snapshot.fields).toHaveLength(2);
    expect(snapshot.records).toEqual([
      {
        id: 'recCompat000000001',
        fields: {
          fldCompatA00000001: 'fldCompatA00000001:value',
          fldCompatB00000001: 'fldCompatB00000001:value',
        },
      },
    ]);
  });

  it('writes conditional lookup snapshots in the legacy field shape', async () => {
    const { db, query } = createInsertDb();
    const tableMapper = createConditionalLookupTableMapper();
    const completion = new V2FieldDeleteCompatCompletion(
      createV2ContainerService(db, tableMapper) as never,
      {
        batchUpdateViewByOps: vi.fn(),
      } as never,
      {
        tableId: 'tblCompatTable0001',
        userId: 'usrCompatWriter00001',
        operationId: 'opCompatDelete000002',
        frozenFieldOps: {},
        snapshots: [
          {
            table: { kind: 'domainTable' },
            snapshot: {
              field: {
                id: 'fldCondLookup000001',
                name: 'Conditional Lookup',
                type: 'conditionalLookup',
              },
              views: [
                {
                  viewId: 'viwCompat000000001',
                  columnMeta: { order: 1, hidden: false },
                },
              ],
            },
          },
        ] as never,
        referencesByFieldId: new Map<string, ReadonlyArray<string>>(),
      }
    );

    const executionContext = {} as never;

    const result = await completion.complete(executionContext);

    expect(result._unsafeUnwrap()).toBeUndefined();
    const insertPayload = query.values.mock.calls[0]?.[0] as { snapshot: string };
    const snapshot = JSON.parse(insertPayload.snapshot);
    expect(snapshot.fields[0]).toMatchObject({
      id: 'fldCondLookup000001',
      type: 'number',
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldForeign00000001',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
        sort: { fieldId: 'fldScore0000000001', order: 'desc' },
        limit: 5,
      },
      options: { formatting: { type: 'decimal', precision: 2 } },
    });
  });
});
