import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { FieldCreated } from '../../domain/table/events/FieldCreated';
import { FieldDeleted } from '../../domain/table/events/FieldDeleted';
import { FieldOptionsAdded } from '../../domain/table/events/FieldOptionsAdded';
import { FieldUpdated } from '../../domain/table/events/FieldUpdated';
import { RecordCreated } from '../../domain/table/events/RecordCreated';
import { RecordReordered } from '../../domain/table/events/RecordReordered';
import { RecordsBatchCreated } from '../../domain/table/events/RecordsBatchCreated';
import { RecordsBatchUpdated } from '../../domain/table/events/RecordsBatchUpdated';
import { RecordsDeleted } from '../../domain/table/events/RecordsDeleted';
import { RecordUpdated } from '../../domain/table/events/RecordUpdated';
import { TableCreated } from '../../domain/table/events/TableCreated';
import { TableDeleted } from '../../domain/table/events/TableDeleted';
import { TableRestored } from '../../domain/table/events/TableRestored';
import { TableTrashed } from '../../domain/table/events/TableTrashed';
import { ViewColumnMetaUpdated } from '../../domain/table/events/ViewColumnMetaUpdated';
import { ViewCreated } from '../../domain/table/events/ViewCreated';
import { ViewDeleted } from '../../domain/table/events/ViewDeleted';
import { ViewDescriptionUpdated } from '../../domain/table/events/ViewDescriptionUpdated';
import { ViewFilterUpdated } from '../../domain/table/events/ViewFilterUpdated';
import { ViewGroupUpdated } from '../../domain/table/events/ViewGroupUpdated';
import { ViewLockedUpdated } from '../../domain/table/events/ViewLockedUpdated';
import { ViewManualSortApplied } from '../../domain/table/events/ViewManualSortApplied';
import { ViewOptionsUpdated } from '../../domain/table/events/ViewOptionsUpdated';
import { ViewOrderUpdated } from '../../domain/table/events/ViewOrderUpdated';
import { ViewRenamed } from '../../domain/table/events/ViewRenamed';
import { ViewShareDisabled } from '../../domain/table/events/ViewShareDisabled';
import { ViewShareEnabled } from '../../domain/table/events/ViewShareEnabled';
import { ViewShareIdRefreshed } from '../../domain/table/events/ViewShareIdRefreshed';
import { ViewShareMetaUpdated } from '../../domain/table/events/ViewShareMetaUpdated';
import { ViewSortUpdated } from '../../domain/table/events/ViewSortUpdated';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../../domain/table/fields/types/LinkFieldConfig';
import { LinkRelationship } from '../../domain/table/fields/types/LinkRelationship';
import { LookupOptions } from '../../domain/table/fields/types/LookupOptions';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { NumberFormatting } from '../../domain/table/fields/types/NumberFormatting';
import { SelectOption } from '../../domain/table/fields/types/SelectOption';
import { RecordId } from '../../domain/table/records/RecordId';
import { TableAddSelectOptionsSpec } from '../../domain/table/specs/TableAddSelectOptionsSpec';
import { TableUpdateFieldTypeSpec } from '../../domain/table/specs/TableUpdateFieldTypeSpec';
import { TableUpdateViewShareIdSpec } from '../../domain/table/specs/TableUpdateViewShareIdSpec';
import { TableEventGeneratingSpecVisitor } from '../../domain/table/specs/visitors/TableEventGeneratingSpecVisitor';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { View } from '../../domain/table/views/View';
import { ViewId } from '../../domain/table/views/ViewId';
import { ViewName } from '../../domain/table/views/ViewName';
import { ViewOrder } from '../../domain/table/views/ViewOrder';
import type { IAttachmentUrlSignerService } from '../../ports/AttachmentUrlSignerService';
import { createEventDispatchScope } from '../../ports/EventHandler';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import type { ITableMapper, ITablePersistenceDTO } from '../../ports/mappers/TableMapper';
import type { RealtimeChange } from '../../ports/RealtimeChange';
import type { RealtimeDocId } from '../../ports/RealtimeDocId';
import type { IRealtimeEngine, RealtimeApplyChangeOptions } from '../../ports/RealtimeEngine';
import type { ITableRepository } from '../../ports/TableRepository';
import { AttachmentValueDecoratorService } from '../services/AttachmentValueDecoratorService';
import { FieldCreatedRealtimeProjection } from './FieldCreatedRealtimeProjection';
import { FieldDeletedRealtimeProjection } from './FieldDeletedRealtimeProjection';
import { FieldOptionsAddedRealtimeProjection } from './FieldOptionsAddedRealtimeProjection';
import { FieldUpdatedRealtimeProjection } from './FieldUpdatedRealtimeProjection';
import { RecordCreatedRealtimeProjection } from './RecordCreatedRealtimeProjection';
import { RecordReorderedRealtimeProjection } from './RecordReorderedRealtimeProjection';
import { RecordsBatchCreatedRealtimeProjection } from './RecordsBatchCreatedRealtimeProjection';
import { RecordsBatchUpdatedRealtimeProjection } from './RecordsBatchUpdatedRealtimeProjection';
import { RecordsDeletedRealtimeProjection } from './RecordsDeletedRealtimeProjection';
import { RecordUpdatedRealtimeProjection } from './RecordUpdatedRealtimeProjection';
import { REALTIME_TASK_CONCURRENCY_LIMIT } from './runRealtimeTasks';
import { setRealtimeProjectionSchedulerForTest } from './scheduleRealtimeProjection';
import { TableCreatedRealtimeProjection } from './TableCreatedRealtimeProjection';
import { TableDeletedRealtimeProjection } from './TableDeletedRealtimeProjection';
import { buildRecordCollection } from './TableRecordRealtimeDTO';
import { ViewColumnMetaUpdatedRealtimeProjection } from './ViewColumnMetaUpdatedRealtimeProjection';
import { ViewCreatedRealtimeProjection } from './ViewCreatedRealtimeProjection';
import { ViewDeletedRealtimeProjection } from './ViewDeletedRealtimeProjection';
import { ViewDescriptionUpdatedRealtimeProjection } from './ViewDescriptionUpdatedRealtimeProjection';
import { ViewFilterUpdatedRealtimeProjection } from './ViewFilterUpdatedRealtimeProjection';
import { ViewGroupUpdatedRealtimeProjection } from './ViewGroupUpdatedRealtimeProjection';
import { ViewLockedUpdatedRealtimeProjection } from './ViewLockedUpdatedRealtimeProjection';
import { ViewManualSortAppliedRealtimeProjection } from './ViewManualSortAppliedRealtimeProjection';
import { ViewOptionsUpdatedRealtimeProjection } from './ViewOptionsUpdatedRealtimeProjection';
import { ViewOrderUpdatedRealtimeProjection } from './ViewOrderUpdatedRealtimeProjection';
import { ViewRenamedRealtimeProjection } from './ViewRenamedRealtimeProjection';
import { ViewShareIdRefreshedRealtimeProjection } from './ViewShareIdRefreshedRealtimeProjection';
import { ViewShareMetaUpdatedRealtimeProjection } from './ViewShareMetaUpdatedRealtimeProjection';
import {
  ViewShareDisabledRealtimeProjection,
  ViewShareEnabledRealtimeProjection,
} from './ViewShareStateRealtimeProjection';
import { ViewSortUpdatedRealtimeProjection } from './ViewSortUpdatedRealtimeProjection';

const fieldUpdateSemantics = {
  type: {
    realtimePath: ['type'],
    presencePath: ['type'],
    mayRequirePresence: true,
  },
  options: {
    realtimePath: ['options'],
    presencePath: ['options'],
    mayRequirePresence: true,
  },
  formatting: {
    realtimePath: ['options'],
    presencePath: ['options', 'formatting'],
    mayRequirePresence: true,
  },
  lookupOptions: {
    realtimePath: ['lookupOptions'],
    presencePath: ['lookupOptions'],
    mayRequirePresence: true,
  },
} as const;

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = (baseSeed: string, tableSeed: string, fieldSeed: string) => {
  const baseId = BaseId.create(`bse${baseSeed.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${tableSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create(`Table ${tableSeed}`)._unsafeUnwrap();
  const fieldId = FieldId.create(`fld${fieldSeed.repeat(16)}`)._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withId(fieldId).withName(fieldName).primary().done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildTableDto = (table: Table): ITablePersistenceDTO => {
  const view = table.views()[0];
  return {
    id: table.id().toString(),
    baseId: table.baseId().toString(),
    name: table.name().toString(),
    primaryFieldId: table.primaryFieldId().toString(),
    fields: [
      {
        id: table.primaryFieldId().toString(),
        name: 'Title',
        type: 'singleLineText',
      },
    ],
    views: [
      {
        id: view.id().toString(),
        name: view.name().toString(),
        type: view.type().toString() as 'grid',
        columnMeta: {
          [table.primaryFieldId().toString()]: { order: 0 },
        },
      },
    ],
  };
};

class FakeRealtimeEngine implements IRealtimeEngine {
  ensures: Array<{ docId: RealtimeDocId; initial: unknown }> = [];
  changes: Array<{
    docId: RealtimeDocId;
    change: RealtimeChange | ReadonlyArray<RealtimeChange>;
    options?: RealtimeApplyChangeOptions;
  }> = [];
  deletes: RealtimeDocId[] = [];
  deleteOptions: Array<RealtimeApplyChangeOptions | undefined> = [];
  invalidations: Array<{ collection: string; change: RealtimeChange }> = [];

  async ensure(_context: IExecutionContext, docId: RealtimeDocId, initial: unknown) {
    this.ensures.push({ docId, initial });
    return ok(undefined);
  }

  async applyChange(
    _context: IExecutionContext,
    docId: RealtimeDocId,
    change: RealtimeChange | ReadonlyArray<RealtimeChange>,
    options?: RealtimeApplyChangeOptions
  ) {
    this.changes.push({ docId, change, options });
    return ok(undefined);
  }

  async delete(
    _context: IExecutionContext,
    docId: RealtimeDocId,
    options?: RealtimeApplyChangeOptions
  ) {
    this.deletes.push(docId);
    this.deleteOptions.push(options);
    return ok(undefined);
  }

  async invalidateCollection(
    _context: IExecutionContext,
    collection: string,
    change: RealtimeChange
  ) {
    this.invalidations.push({ collection, change });
    return ok(undefined);
  }
}

class FakeTableRepository implements ITableRepository {
  findOneCount = 0;
  findOneDeferred?: {
    promise: Promise<void>;
    resolve: () => void;
  };

  constructor(private readonly table: Table) {}

  async insert() {
    return ok(this.table);
  }

  async insertMany() {
    return ok([this.table]);
  }

  async findOne() {
    this.findOneCount += 1;
    await this.findOneDeferred?.promise;
    return ok(this.table);
  }

  async find() {
    return ok([this.table]);
  }

  async updateOne() {
    return ok(undefined);
  }

  async restore() {
    return ok(undefined);
  }

  async delete() {
    return ok(undefined);
  }
}

class FakeTableMapper implements ITableMapper {
  constructor(private readonly factory: (table: Table) => ITablePersistenceDTO) {}

  toDTO(table: Table) {
    return ok(this.factory(table));
  }

  toViewDTO(view: View) {
    return new DefaultTableMapper().toViewDTO(view);
  }
  toDomain() {
    return err(domainError.unexpected({ message: 'not used' }));
  }
}

class FakeAttachmentUrlSignerService implements IAttachmentUrlSignerService {
  invalidatedTokens: string[] = [];

  async signItems(items: ReadonlyArray<{ token: string }>) {
    return ok(
      new Map(
        items.map((item) => [
          item.token,
          {
            presignedUrl: `/preview/${item.token}`,
            smThumbnailUrl: `/preview/${item.token}_sm`,
            lgThumbnailUrl: `/preview/${item.token}_lg`,
          },
        ])
      )
    );
  }

  async invalidatePreview(tokens: ReadonlyArray<string>) {
    this.invalidatedTokens.push(...tokens);
    return ok(undefined);
  }
}

const buildAttachmentValueDecorator = () =>
  new AttachmentValueDecoratorService(new FakeAttachmentUrlSignerService());

const captureRealtimeTasks = () => {
  const tasks: Array<() => Promise<void>> = [];
  setRealtimeProjectionSchedulerForTest((task) => {
    tasks.push(task);
  });
  return tasks;
};

describe('Realtime projections', () => {
  afterEach(() => {
    setRealtimeProjectionSchedulerForTest();
  });

  it('builds record collection names', () => {
    expect(buildRecordCollection('tbl123')).toBe('rec_tbl123');
  });

  it('projects record creation', async () => {
    const table = buildTable('a', 'b', 'c');
    const recordId = RecordId.create(`rec${'d'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const projection = new RecordCreatedRealtimeProjection(engine);

    const event = RecordCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      recordId,
      fieldValues: [{ fieldId: table.primaryFieldId().toString(), value: 'Alpha' }],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures).toHaveLength(1);
    expect(engine.ensures[0]?.docId.toString()).toBe(
      `${buildRecordCollection(table.id().toString())}/${recordId.toString()}`
    );
  });

  it('decorates attachment preview urls before projecting record creation', async () => {
    const table = buildTable('a', 'b', 'c');
    const recordId = RecordId.create(`rec${'d'.repeat(16)}`)._unsafeUnwrap();
    const attachmentFieldId = `fld${'p'.repeat(16)}`;
    const engine = new FakeRealtimeEngine();
    const projection = new RecordCreatedRealtimeProjection(engine, buildAttachmentValueDecorator());

    const event = RecordCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      recordId,
      fieldValues: [
        {
          fieldId: attachmentFieldId,
          value: [
            {
              id: 'act-create',
              name: 'receipt.png',
              token: 'tok-create',
              path: 'table/tok-create',
              size: 123,
              mimetype: 'image/png',
              width: 320,
              height: 180,
            },
          ],
        },
      ],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures[0]?.initial).toEqual({
      id: recordId.toString(),
      fields: {
        [attachmentFieldId]: [
          expect.objectContaining({
            token: 'tok-create',
            presignedUrl: '/preview/tok-create',
            smThumbnailUrl: '/preview/tok-create_sm',
            lgThumbnailUrl: '/preview/tok-create_lg',
            width: 320,
            height: 180,
          }),
        ],
      },
    });
  });

  it('projects record updates with incremental changes', async () => {
    const table = buildTable('a', 'e', 'f');
    const recordId = RecordId.create(`rec${'g'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const projection = new RecordUpdatedRealtimeProjection(engine);

    const event = RecordUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      recordId,
      oldVersion: 1,
      newVersion: 2,
      source: 'user',
      changes: [
        {
          fieldId: table.primaryFieldId().toString(),
          oldValue: 'Old',
          newValue: 'New',
        },
      ],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    // Update projections should NOT call ensure() - only applyChange()
    // ensure() broadcasts a create op with empty fields which would overwrite client data
    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['fields', table.primaryFieldId().toString()],
        value: 'New',
        oldValue: 'Old',
      },
    ]);
  });

  it('decorates attachment preview urls before projecting record updates', async () => {
    const table = buildTable('a', 'e', 'f');
    const recordId = RecordId.create(`rec${'g'.repeat(16)}`)._unsafeUnwrap();
    const attachmentFieldId = `fld${'q'.repeat(16)}`;
    const engine = new FakeRealtimeEngine();
    const projection = new RecordUpdatedRealtimeProjection(engine, buildAttachmentValueDecorator());

    const event = RecordUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      recordId,
      oldVersion: 1,
      newVersion: 2,
      source: 'user',
      changes: [
        {
          fieldId: attachmentFieldId,
          oldValue: [],
          newValue: [
            {
              id: 'act-update',
              name: 'invoice.png',
              token: 'tok-update',
              path: 'table/tok-update',
              size: 456,
              mimetype: 'image/png',
            },
          ],
        },
      ],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['fields', attachmentFieldId],
        oldValue: [],
        value: [
          expect.objectContaining({
            token: 'tok-update',
            presignedUrl: '/preview/tok-update',
            smThumbnailUrl: '/preview/tok-update_sm',
            lgThumbnailUrl: '/preview/tok-update_lg',
          }),
        ],
      },
    ]);
  });

  it('projects batch record updates', async () => {
    const table = buildTable('h', 'i', 'j');
    const engine = new FakeRealtimeEngine();
    const projection = new RecordsBatchUpdatedRealtimeProjection(engine);

    const event = RecordsBatchUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      source: 'user',
      updates: [
        {
          recordId: `rec${'k'.repeat(16)}`,
          oldVersion: 1,
          newVersion: 2,
          changes: [
            {
              fieldId: table.primaryFieldId().toString(),
              oldValue: 'Old',
              newValue: 'New',
            },
          ],
        },
      ],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    // Batch update projections should NOT call ensure() - only applyChange()
    // ensure() broadcasts a create op with empty fields which would overwrite client data
    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['fields', table.primaryFieldId().toString()],
        value: 'New',
        oldValue: 'Old',
      },
    ]);
  });

  it('skips per-record realtime ops for large batch updates', async () => {
    const table = buildTable('m', 'n', 'o');
    const engine = new FakeRealtimeEngine();
    const projection = new RecordsBatchUpdatedRealtimeProjection(engine);

    const event = RecordsBatchUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      source: 'user',
      updates: Array.from({ length: 1001 }, (_, index) => ({
        recordId: `rec${index.toString().padStart(16, '0')}`,
        oldVersion: 1,
        newVersion: 2,
        changes: [
          {
            fieldId: table.primaryFieldId().toString(),
            oldValue: `Old-${index}`,
            newValue: `New-${index}`,
          },
        ],
      })),
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(0);
  });

  it('projects record reorder updates to row-order columns', async () => {
    const table = buildTable('2', '4', '6');
    const viewId = table.views()[0]!.id();
    const recordA = RecordId.create(`rec${'q'.repeat(16)}`)._unsafeUnwrap();
    const recordB = RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const projection = new RecordReorderedRealtimeProjection(engine);

    const event = RecordReordered.create({
      baseId: table.baseId(),
      tableId: table.id(),
      viewId,
      recordIds: [recordA, recordB],
      ordersByRecordId: {
        [recordA.toString()]: 101,
        [recordB.toString()]: 102,
      },
      previousOrdersByRecordId: {
        [recordA.toString()]: 11,
        [recordB.toString()]: 12,
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(2);

    const collection = buildRecordCollection(table.id().toString());
    const rowOrderColumnName = viewId.toRowOrderColumnName();
    expect(engine.changes[0]?.docId.toString()).toBe(`${collection}/${recordA.toString()}`);
    expect(engine.changes[0]?.change).toEqual({
      type: 'set',
      path: ['fields', rowOrderColumnName],
      value: 101,
      oldValue: 11,
    });
    expect(engine.changes[1]?.docId.toString()).toBe(`${collection}/${recordB.toString()}`);
    expect(engine.changes[1]?.change).toEqual({
      type: 'set',
      path: ['fields', rowOrderColumnName],
      value: 102,
      oldValue: 12,
    });
  });

  it('invalidates the record collection after View manual sort materializes row order', async () => {
    const table = buildTable('2', '5', '7');
    const viewId = table.views()[0]!.id();
    const engine = new FakeRealtimeEngine();
    const projection = new ViewManualSortAppliedRealtimeProjection(engine);
    const event = ViewManualSortApplied.create({
      baseId: table.baseId(),
      tableId: table.id(),
      viewId,
      sort: [{ fieldId: table.primaryFieldId().toString(), order: 'asc' }],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.invalidations).toEqual([
      {
        collection: buildRecordCollection(table.id().toString()),
        change: {
          type: 'set',
          path: ['fields', viewId.toRowOrderColumnName()],
          value: null,
          oldValue: null,
        },
      },
    ]);
    expect(engine.changes).toHaveLength(0);
  });

  it('projects batch record creations', async () => {
    const table = buildTable('1', '2', '3');
    const engine = new FakeRealtimeEngine();
    const projection = new RecordsBatchCreatedRealtimeProjection(engine);

    const event = RecordsBatchCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      records: [
        {
          recordId: `rec${'a'.repeat(16)}`,
          fields: [{ fieldId: table.primaryFieldId().toString(), value: 'Record A' }],
        },
        {
          recordId: `rec${'b'.repeat(16)}`,
          fields: [{ fieldId: table.primaryFieldId().toString(), value: 'Record B' }],
        },
      ],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    // Should ensure 2 documents (one for each record)
    expect(engine.ensures).toHaveLength(2);

    // Verify first record
    const collection = buildRecordCollection(table.id().toString());
    expect(engine.ensures[0]?.docId.toString()).toBe(`${collection}/rec${'a'.repeat(16)}`);
    expect(engine.ensures[0]?.initial).toEqual({
      id: `rec${'a'.repeat(16)}`,
      fields: {
        [table.primaryFieldId().toString()]: 'Record A',
      },
    });

    // Verify second record
    expect(engine.ensures[1]?.docId.toString()).toBe(`${collection}/rec${'b'.repeat(16)}`);
    expect(engine.ensures[1]?.initial).toEqual({
      id: `rec${'b'.repeat(16)}`,
      fields: {
        [table.primaryFieldId().toString()]: 'Record B',
      },
    });
  });

  it('skips per-record realtime creates for large batch creations when orchestration carries total count', async () => {
    const table = buildTable('1', '2', '3');
    const engine = new FakeRealtimeEngine();
    const projection = new RecordsBatchCreatedRealtimeProjection(engine);

    const event = RecordsBatchCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      records: [
        {
          recordId: `rec${'a'.repeat(16)}`,
          fields: [{ fieldId: table.primaryFieldId().toString(), value: 'Record A' }],
        },
      ],
      orchestration: {
        totalRecordCount: 2000,
        totalChunkCount: 4,
        chunkIndex: 0,
        scope: 'chunk',
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures).toHaveLength(0);
  });

  it('skips per-record realtime creates when streamed orchestration reaches the total threshold', async () => {
    const table = buildTable('1', '2', '3');
    const engine = new FakeRealtimeEngine();
    const projection = new RecordsBatchCreatedRealtimeProjection(engine);

    const event = RecordsBatchCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      records: [
        {
          recordId: `rec${'a'.repeat(16)}`,
          fields: [{ fieldId: table.primaryFieldId().toString(), value: 'Record A' }],
        },
      ],
      orchestration: {
        totalRecordCount: 1000,
        totalChunkCount: 5,
        chunkIndex: 0,
        scope: 'chunk',
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures).toHaveLength(0);
  });

  it('dispatches record creations without serially awaiting each realtime ensure', async () => {
    const table = buildTable('1', '2', '3');
    const startOrder: string[] = [];
    const resolvers: Array<() => void> = [];
    const engine: IRealtimeEngine = {
      ensure: async (_context, docId) => {
        startOrder.push(docId.toString());
        await new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
        return ok(undefined);
      },
      applyChange: async () => ok(undefined),
      delete: async () => ok(undefined),
      invalidateCollection: async () => ok(undefined),
    };
    const projection = new RecordsBatchCreatedRealtimeProjection(engine);

    const event = RecordsBatchCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      records: [
        {
          recordId: `rec${'a'.repeat(16)}`,
          fields: [{ fieldId: table.primaryFieldId().toString(), value: 'Record A' }],
        },
        {
          recordId: `rec${'b'.repeat(16)}`,
          fields: [{ fieldId: table.primaryFieldId().toString(), value: 'Record B' }],
        },
      ],
    });

    const handlePromise = projection.handle(createContext(), event);
    while (startOrder.length < 2) {
      await Promise.resolve();
    }

    expect(startOrder).toHaveLength(2);

    for (const resolve of resolvers) {
      resolve();
    }

    const result = await handlePromise;
    result._unsafeUnwrap();
  });

  it('bounds batch record creation realtime concurrency', async () => {
    const table = buildTable('1', '2', '3');
    let inFlight = 0;
    let maxInFlight = 0;
    let block = true;
    const resolvers = new Map<string, () => void>();
    const engine: IRealtimeEngine = {
      ensure: async (_context, docId) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        if (block) {
          await new Promise<void>((resolve) => {
            resolvers.set(docId.toString(), resolve);
          });
        }

        inFlight -= 1;
        return ok(undefined);
      },
      applyChange: async () => ok(undefined),
      delete: async () => ok(undefined),
      invalidateCollection: async () => ok(undefined),
    };
    const projection = new RecordsBatchCreatedRealtimeProjection(engine);

    const event = RecordsBatchCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      records: Array.from({ length: REALTIME_TASK_CONCURRENCY_LIMIT + 8 }, (_, index) => ({
        recordId: `rec${index.toString().padStart(16, '0')}`,
        fields: [{ fieldId: table.primaryFieldId().toString(), value: `Record ${index}` }],
      })),
    });

    const handlePromise = projection.handle(createContext(), event);
    while (resolvers.size < REALTIME_TASK_CONCURRENCY_LIMIT) {
      await Promise.resolve();
    }

    expect(maxInFlight).toBe(REALTIME_TASK_CONCURRENCY_LIMIT);

    block = false;
    for (const resolve of resolvers.values()) {
      resolve();
    }

    const result = await handlePromise;
    result._unsafeUnwrap();
  });

  it('projects record deletions', async () => {
    const table = buildTable('l', 'm', 'n');
    const engine = new FakeRealtimeEngine();
    const projection = new RecordsDeletedRealtimeProjection(engine);

    const event = RecordsDeleted.create({
      baseId: table.baseId(),
      tableId: table.id(),
      recordIds: [
        RecordId.create(`rec${'o'.repeat(16)}`)._unsafeUnwrap(),
        RecordId.create(`rec${'p'.repeat(16)}`)._unsafeUnwrap(),
      ],
      recordSnapshots: [
        { id: `rec${'o'.repeat(16)}`, fields: { Title: 'Record O' } },
        { id: `rec${'p'.repeat(16)}`, fields: { Title: 'Record P' } },
      ],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.deletes).toHaveLength(2);
  });

  it('skips per-record realtime deletes for large record deletions', async () => {
    const table = buildTable('l', 'm', 'n');
    const engine = new FakeRealtimeEngine();
    const projection = new RecordsDeletedRealtimeProjection(engine);

    const recordIds = Array.from({ length: 1001 }, (_, index) =>
      RecordId.create(`rec${index.toString().padStart(16, '0')}`)._unsafeUnwrap()
    );
    const event = RecordsDeleted.create({
      baseId: table.baseId(),
      tableId: table.id(),
      recordIds,
      recordSnapshots: recordIds.map((recordId) => ({
        id: recordId.toString(),
        fields: { Title: recordId.toString() },
      })),
      orchestration: {
        totalRecordCount: recordIds.length,
        totalChunkCount: 3,
        chunkIndex: 0,
        scope: 'chunk',
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.deletes).toHaveLength(0);
  });

  it('skips per-record realtime deletes when streamed orchestration reaches the total threshold', async () => {
    const table = buildTable('l', 'm', 'n');
    const engine = new FakeRealtimeEngine();
    const projection = new RecordsDeletedRealtimeProjection(engine);

    const recordIds = Array.from({ length: 250 }, (_, index) =>
      RecordId.create(`rec${index.toString().padStart(16, '0')}`)._unsafeUnwrap()
    );
    const event = RecordsDeleted.create({
      baseId: table.baseId(),
      tableId: table.id(),
      recordIds,
      recordSnapshots: recordIds.map((recordId) => ({
        id: recordId.toString(),
        fields: { Title: recordId.toString() },
      })),
      orchestration: {
        totalRecordCount: 1000,
        totalChunkCount: 5,
        chunkIndex: 1,
        scope: 'chunk',
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.deletes).toHaveLength(0);
  });

  it('dispatches record deletions without serially awaiting each realtime delete', async () => {
    const table = buildTable('l', 'm', 'n');
    const startOrder: string[] = [];
    const resolvers: Array<() => void> = [];
    const engine: IRealtimeEngine = {
      ensure: async () => ok(undefined),
      applyChange: async () => ok(undefined),
      delete: async (_context, docId) => {
        startOrder.push(docId.toString());
        await new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
        return ok(undefined);
      },
      invalidateCollection: async () => ok(undefined),
    };
    const projection = new RecordsDeletedRealtimeProjection(engine);

    const event = RecordsDeleted.create({
      baseId: table.baseId(),
      tableId: table.id(),
      recordIds: [
        RecordId.create(`rec${'o'.repeat(16)}`)._unsafeUnwrap(),
        RecordId.create(`rec${'p'.repeat(16)}`)._unsafeUnwrap(),
      ],
      recordSnapshots: [
        { id: `rec${'o'.repeat(16)}`, fields: { Title: 'Record O' } },
        { id: `rec${'p'.repeat(16)}`, fields: { Title: 'Record P' } },
      ],
    });

    const handlePromise = projection.handle(createContext(), event);
    while (startOrder.length < 2) {
      await Promise.resolve();
    }

    expect(startOrder).toHaveLength(2);

    for (const resolve of resolvers) {
      resolve();
    }

    const result = await handlePromise;
    result._unsafeUnwrap();
  });

  it('bounds batch record update realtime concurrency while preserving per-record order', async () => {
    const table = buildTable('h', 'i', 'j');
    let inFlight = 0;
    let maxInFlight = 0;
    const started: string[] = [];
    let block = true;
    const resolvers = new Map<string, () => void>();
    const engine: IRealtimeEngine = {
      ensure: async () => ok(undefined),
      delete: async () => ok(undefined),
      applyChange: async (_context, docId) => {
        const key = docId.toString();
        started.push(key);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        if (block) {
          await new Promise<void>((resolve) => {
            resolvers.set(key, resolve);
          });
        }

        inFlight -= 1;
        return ok(undefined);
      },
      invalidateCollection: async () => ok(undefined),
    };
    const projection = new RecordsBatchUpdatedRealtimeProjection(engine);

    const updates = Array.from({ length: REALTIME_TASK_CONCURRENCY_LIMIT + 5 }, (_, index) => ({
      recordId: `rec${index.toString().padStart(16, '0')}`,
      oldVersion: 1,
      newVersion: 2,
      changes: [
        {
          fieldId: table.primaryFieldId().toString(),
          oldValue: `Old-${index}`,
          newValue: `New-${index}`,
        },
      ],
    }));

    const handlePromise = projection.handle(
      createContext(),
      RecordsBatchUpdated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        source: 'user',
        updates,
      })
    );

    while (resolvers.size < REALTIME_TASK_CONCURRENCY_LIMIT) {
      await Promise.resolve();
    }

    expect(maxInFlight).toBe(REALTIME_TASK_CONCURRENCY_LIMIT);
    expect(started).toHaveLength(REALTIME_TASK_CONCURRENCY_LIMIT);

    block = false;
    for (const resolve of resolvers.values()) {
      resolve();
    }

    const result = await handlePromise;
    result._unsafeUnwrap();
  });

  it('projects table creation and field snapshots', async () => {
    const table = buildTable('q', 'r', 's');
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new TableCreatedRealtimeProjection(repository, mapper, engine);

    const event = TableCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      tableName: table.name(),
      fieldIds: table.fieldIds(),
      viewIds: table.views().map((view) => view.id()),
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures.length).toBe(2);
  });

  it('re-ensures the Table document when a table is restored from trash', async () => {
    const table = buildTable('7', '8', '9');
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new TableCreatedRealtimeProjection(repository, mapper, engine);

    const event = TableRestored.create({
      baseId: table.baseId(),
      tableId: table.id(),
      tableName: table.name(),
      fieldIds: table.fieldIds(),
      viewIds: table.views().map((view) => view.id()),
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();

    expect(engine.ensures[0]?.docId.toString()).toBe(
      `tbl_${table.baseId().toString()}/${table.id().toString()}`
    );
  });

  it('removes the Table document when a table is trashed', async () => {
    const table = buildTable('1', '2', '3');
    const engine = new FakeRealtimeEngine();
    const projection = new TableDeletedRealtimeProjection(engine);
    const realtimeTasks = captureRealtimeTasks();
    const event = TableTrashed.create({
      baseId: table.baseId(),
      tableId: table.id(),
      tableName: table.name(),
      fieldIds: table.fieldIds(),
      viewIds: table.views().map((view) => view.id()),
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.deletes.map((docId) => docId.toString())).toEqual([
      `tbl_${table.baseId().toString()}/${table.id().toString()}`,
    ]);
  });

  it('removes the Table document when a table is permanently deleted', async () => {
    const table = buildTable('4', '5', '6');
    const engine = new FakeRealtimeEngine();
    const projection = new TableDeletedRealtimeProjection(engine);
    const realtimeTasks = captureRealtimeTasks();
    const event = TableDeleted.create({
      baseId: table.baseId(),
      tableId: table.id(),
      tableName: table.name(),
      fieldIds: table.fieldIds(),
      viewIds: table.views().map((view) => view.id()),
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.deletes.map((docId) => docId.toString())).toEqual([
      `tbl_${table.baseId().toString()}/${table.id().toString()}`,
    ]);
  });

  it('projects field creation when snapshot is available', async () => {
    const table = buildTable('t', 'u', 'v');
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new FieldCreatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();

    const event = FieldCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId: table.primaryFieldId(),
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures.length).toBe(0);
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures.length).toBe(2);
  });

  it('fails when field snapshot is missing', async () => {
    const table = buildTable('w', 'x', 'y');
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [],
    }));
    const projection = new FieldCreatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();

    const event = FieldCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId: table.primaryFieldId(),
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures).toHaveLength(1);
  });

  it('projects field deletion', async () => {
    const table = buildTable('z', 'a', 'b');
    const engine = new FakeRealtimeEngine();
    const projection = new FieldDeletedRealtimeProjection(engine);

    const event = FieldDeleted.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId: table.primaryFieldId(),
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.deletes).toHaveLength(1);
  });

  it('creates standalone View documents with HTTP-compatible query fields', async () => {
    const table = buildTable('v', 'c', 'q');
    const view = table.views()[0]!;
    const filter = {
      conjunction: 'and',
      filterSet: [{ fieldId: table.primaryFieldId().toString(), operator: 'is', value: 'ready' }],
    };
    const sort = {
      sortObjs: [{ fieldId: table.primaryFieldId().toString(), order: 'desc' }],
      manualSort: false,
    };
    const group = [{ fieldId: table.primaryFieldId().toString(), order: 'asc' }];
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => {
      const snapshot = buildTableDto(candidate);
      return {
        ...snapshot,
        views: snapshot.views.map((viewDto) => ({
          ...viewDto,
          query: { filter, sort: sort.sortObjs, manualSort: sort.manualSort, group },
          sourceFilter: filter,
        })),
      };
    });
    const projection = new ViewCreatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();

    (
      await projection.handle(
        createContext(),
        ViewCreated.create({
          baseId: table.baseId(),
          tableId: table.id(),
          viewId: view.id(),
        })
      )
    )._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.ensures[1]?.initial).toMatchObject({ filter, sort, group });
  });

  it('projects View deletion to the Table document and removes the View document', async () => {
    const originalTable = buildTable('v', 'w', 'x');
    const createResult = originalTable.createView({ type: 'grid', name: 'Temporary' });
    const tableWithView = createResult._unsafeUnwrap().updateResult.table;
    const deletedViewId = createResult._unsafeUnwrap().view.id();
    const table = tableWithView.deleteView(deletedViewId)._unsafeUnwrap().updateResult.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new DefaultTableMapper();
    const projection = new ViewDeletedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewDeleted.create({
      baseId: table.baseId(),
      tableId: table.id(),
      viewId: deletedViewId,
      oldVersion: 7,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures[0]?.docId.toString()).toBe(
      `tbl_${table.baseId().toString()}/${table.id().toString()}`
    );
    expect(engine.changes[0]?.change).toMatchObject({
      type: 'set',
      path: ['views'],
    });
    expect(engine.deletes[0]?.toString()).toBe(
      `viw_${table.id().toString()}/${deletedViewId.toString()}`
    );
    expect(engine.deleteOptions[0]).toEqual({ version: 7 });
  });

  it('projects View rename to the Table and standalone View documents with persisted version', async () => {
    const originalTable = buildTable('r', 's', 't');
    const targetView = originalTable.views()[0]!;
    const renamed = originalTable
      .renameView(targetView.id(), ViewName.create('Renamed view')._unsafeUnwrap())
      ._unsafeUnwrap().updateResult.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(renamed);
    const mapper = new DefaultTableMapper();
    const projection = new ViewRenamedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewRenamed.create({
      baseId: renamed.baseId(),
      tableId: renamed.id(),
      viewId: targetView.id(),
      previousName: targetView.name(),
      nextName: ViewName.create('Renamed view')._unsafeUnwrap(),
      oldVersion: 11,
      newVersion: 12,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures.map(({ docId }) => docId.toString())).toEqual([
      `tbl_${renamed.baseId().toString()}/${renamed.id().toString()}`,
      `viw_${renamed.id().toString()}/${targetView.id().toString()}`,
    ]);
    expect(engine.changes[0]).toMatchObject({
      docId: expect.objectContaining({}),
      change: {
        type: 'set',
        path: ['views', 0, 'name'],
        value: 'Renamed view',
      },
    });
    expect(engine.changes[0]?.docId.toString()).toBe(
      `tbl_${renamed.baseId().toString()}/${renamed.id().toString()}`
    );
    expect(engine.changes[1]?.docId.toString()).toBe(
      `viw_${renamed.id().toString()}/${targetView.id().toString()}`
    );
    expect(engine.changes[1]?.change).toEqual({
      type: 'set',
      path: ['name'],
      value: 'Renamed view',
    });
    expect(engine.changes[1]?.options).toEqual({ version: 11 });
  });

  it('projects persisted View audit metadata with a View mutation', async () => {
    const originalTable = buildTable('a', 'u', 'd');
    const targetView = originalTable.views()[0]!;
    const renamed = originalTable
      .renameView(targetView.id(), ViewName.create('Audited view')._unsafeUnwrap())
      ._unsafeUnwrap().updateResult.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(renamed);
    const lastModifiedBy = 'usr-audit';
    const lastModifiedTime = '2026-08-11T15:00:00.000Z';
    const mapper = new FakeTableMapper((table) => {
      const snapshot = new DefaultTableMapper().toDTO(table)._unsafeUnwrap();
      return {
        ...snapshot,
        views: snapshot.views.map((view) => ({
          ...view,
          lastModifiedBy,
          lastModifiedTime,
        })),
      };
    });
    const projection = new ViewRenamedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();

    (
      await projection.handle(
        createContext(),
        ViewRenamed.create({
          baseId: renamed.baseId(),
          tableId: renamed.id(),
          viewId: targetView.id(),
          previousName: targetView.name(),
          nextName: ViewName.create('Audited view')._unsafeUnwrap(),
          oldVersion: 20,
          newVersion: 21,
        })
      )
    )._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['views', 0, 'lastModifiedBy'],
          value: lastModifiedBy,
        }),
        expect.objectContaining({
          path: ['views', 0, 'lastModifiedTime'],
          value: lastModifiedTime,
        }),
      ])
    );
    expect(engine.changes[1]?.change).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['lastModifiedBy'], value: lastModifiedBy }),
        expect.objectContaining({ path: ['lastModifiedTime'], value: lastModifiedTime }),
      ])
    );
    expect(engine.changes[1]?.options).toEqual({ version: 20 });
  });

  it('projects View description to Table and standalone View documents with persisted version', async () => {
    const originalTable = buildTable('u', 'v', 'w');
    const targetView = originalTable.views()[0]!;
    const updated = originalTable
      .updateViewDescription(targetView.id(), 'Updated description')
      ._unsafeUnwrap().updateResult.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewDescriptionUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewDescriptionUpdated.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousDescription: undefined,
      nextDescription: 'Updated description',
      oldVersion: 12,
      newVersion: 13,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures.map(({ docId }) => docId.toString())).toEqual([
      `tbl_${updated.baseId().toString()}/${updated.id().toString()}`,
      `viw_${updated.id().toString()}/${targetView.id().toString()}`,
    ]);
    expect(engine.changes[0]).toMatchObject({
      change: {
        type: 'set',
        path: ['views', 0, 'description'],
        value: 'Updated description',
      },
    });
    expect(engine.changes[1]?.change).toEqual({
      type: 'set',
      path: ['description'],
      value: 'Updated description',
    });
    expect(engine.changes[1]?.options).toEqual({ version: 12 });
  });

  it('projects View filter query defaults to Table and standalone View documents', async () => {
    const originalTable = buildTable('f', 'g', 'h');
    const targetView = originalTable.views()[0]!;
    const filter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: originalTable.primaryFieldId().toString(),
          operator: 'is' as const,
          value: 'alpha',
        },
      ],
    };
    const query = {
      filter: {
        conjunction: 'and',
        items: [
          {
            fieldId: originalTable.primaryFieldId().toString(),
            operator: 'is',
            value: 'alpha',
          },
        ],
      },
    };
    const updated = originalTable.updateViewFilter(targetView.id(), filter)._unsafeUnwrap()
      .updateResult!.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewFilterUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewFilterUpdated.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousFilter: undefined,
      nextFilter: filter,
      oldVersion: 13,
      newVersion: 14,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures.map(({ docId }) => docId.toString())).toEqual([
      `tbl_${updated.baseId().toString()}/${updated.id().toString()}`,
      `viw_${updated.id().toString()}/${targetView.id().toString()}`,
    ]);
    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['views', 0, 'query'],
        value: query,
      },
      {
        type: 'set',
        path: ['views', 0, 'sourceFilter'],
        value: filter,
        oldValue: undefined,
      },
      {
        type: 'set',
        path: ['views', 0, 'filter'],
        value: filter,
        oldValue: undefined,
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      {
        type: 'set',
        path: ['query'],
        value: query,
      },
      {
        type: 'set',
        path: ['sourceFilter'],
        value: filter,
        oldValue: undefined,
      },
      {
        type: 'set',
        path: ['filter'],
        value: filter,
        oldValue: undefined,
      },
    ]);
    expect(engine.changes[1]?.options).toEqual({ version: 13 });
  });

  it('projects a cleared View filter as a valid object deletion', async () => {
    const originalTable = buildTable('i', 'j', 'k');
    const targetView = originalTable.views()[0]!;
    const filter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: originalTable.primaryFieldId().toString(),
          operator: 'is' as const,
          value: 'alpha',
        },
      ],
    };
    const filtered = originalTable.updateViewFilter(targetView.id(), filter)._unsafeUnwrap()
      .updateResult!.table;
    const cleared = filtered.updateViewFilter(targetView.id(), null)._unsafeUnwrap().updateResult!
      .table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(cleared);
    const mapper = new FakeTableMapper((table) => {
      const dto = new DefaultTableMapper().toDTO(table)._unsafeUnwrap();
      return {
        ...dto,
        views: dto.views.map((view) => {
          const persistedView = { ...view };
          delete persistedView.sourceFilter;
          return persistedView;
        }),
      };
    });
    const projection = new ViewFilterUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewFilterUpdated.create({
      baseId: cleared.baseId(),
      tableId: cleared.id(),
      viewId: targetView.id(),
      previousFilter: filter,
      nextFilter: null,
      oldVersion: 14,
      newVersion: 15,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual(
      expect.arrayContaining([
        {
          type: 'set',
          path: ['views', 0, 'sourceFilter'],
          value: undefined,
          oldValue: filter,
        },
        {
          type: 'set',
          path: ['views', 0, 'filter'],
          value: undefined,
          oldValue: filter,
        },
      ])
    );
    expect(engine.changes[1]?.change).toEqual(
      expect.arrayContaining([
        { type: 'set', path: ['sourceFilter'], value: undefined, oldValue: filter },
        { type: 'set', path: ['filter'], value: undefined, oldValue: filter },
      ])
    );
  });

  it('projects View sort query defaults and the legacy standalone View property', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const sort = {
      sortObjs: [{ fieldId: originalTable.primaryFieldId().toString(), order: 'desc' as const }],
      manualSort: false,
    };
    const updated = originalTable.updateViewSort(targetView.id(), sort)._unsafeUnwrap()
      .updateResult!.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewSortUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewSortUpdated.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousSort: null,
      nextSort: sort,
      oldVersion: 13,
      newVersion: 14,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    const query = { sort: sort.sortObjs, manualSort: false };
    expect(engine.ensures.map(({ docId }) => docId.toString())).toEqual([
      `tbl_${updated.baseId().toString()}/${updated.id().toString()}`,
      `viw_${updated.id().toString()}/${targetView.id().toString()}`,
    ]);
    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['views', 0, 'query'],
        value: query,
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      {
        type: 'set',
        path: ['query'],
        value: query,
      },
      {
        type: 'set',
        path: ['sort'],
        value: sort,
        oldValue: undefined,
      },
    ]);
    expect(engine.changes[1]?.options).toEqual({ version: 13 });
  });

  it('projects View group query defaults and the legacy standalone View property', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const group = [{ fieldId: originalTable.primaryFieldId().toString(), order: 'desc' as const }];
    const updated = originalTable.updateViewGroup(targetView.id(), group)._unsafeUnwrap()
      .updateResult!.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewGroupUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewGroupUpdated.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousGroup: null,
      nextGroup: group,
      oldVersion: 14,
      newVersion: 15,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    const query = { group };
    expect(engine.ensures.map(({ docId }) => docId.toString())).toEqual([
      `tbl_${updated.baseId().toString()}/${updated.id().toString()}`,
      `viw_${updated.id().toString()}/${targetView.id().toString()}`,
    ]);
    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['views', 0, 'query'],
        value: query,
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      {
        type: 'set',
        path: ['query'],
        value: query,
      },
      {
        type: 'set',
        path: ['group'],
        value: group,
        oldValue: undefined,
      },
    ]);
    expect(engine.changes[1]?.options).toEqual({ version: 14 });
  });

  it('coalesces compound View query-default events into one standalone operation', async () => {
    const table = buildTable('q', 'u', 'e');
    const view = table.views()[0]!;
    const fieldId = table.primaryFieldId().toString();
    const filter = {
      conjunction: 'and',
      filterSet: [{ fieldId, operator: 'is', value: 'ready' }],
    };
    const sort = {
      sortObjs: [{ fieldId, order: 'desc' as const }],
      manualSort: false,
    };
    const group = [{ fieldId, order: 'asc' as const }];
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => {
      const snapshot = buildTableDto(candidate);
      return {
        ...snapshot,
        views: snapshot.views.map((viewDto) => ({
          ...viewDto,
          query: { filter, sort: sort.sortObjs, manualSort: sort.manualSort, group },
          sourceFilter: filter,
        })),
      };
    });
    const filterProjection = new ViewFilterUpdatedRealtimeProjection(engine, repository, mapper);
    const groupProjection = new ViewGroupUpdatedRealtimeProjection(engine, repository, mapper);
    const sortProjection = new ViewSortUpdatedRealtimeProjection(engine, repository, mapper);
    const context = createContext();
    const dispatchScope = createEventDispatchScope();
    const realtimeTasks = captureRealtimeTasks();

    (
      await filterProjection.handle(
        context,
        ViewFilterUpdated.create({
          baseId: table.baseId(),
          tableId: table.id(),
          viewId: view.id(),
          previousFilter: undefined,
          nextFilter: filter,
          oldVersion: 12,
          newVersion: 13,
        }),
        dispatchScope
      )
    )._unsafeUnwrap();
    (
      await groupProjection.handle(
        context,
        ViewGroupUpdated.create({
          baseId: table.baseId(),
          tableId: table.id(),
          viewId: view.id(),
          previousGroup: null,
          nextGroup: group,
          oldVersion: 12,
          newVersion: 13,
        }),
        dispatchScope
      )
    )._unsafeUnwrap();
    (
      await sortProjection.handle(
        context,
        ViewSortUpdated.create({
          baseId: table.baseId(),
          tableId: table.id(),
          viewId: view.id(),
          previousSort: null,
          nextSort: sort,
          oldVersion: 12,
          newVersion: 13,
        }),
        dispatchScope
      )
    )._unsafeUnwrap();

    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();
    const standaloneChange = engine.changes.find((change) =>
      change.docId.toString().startsWith(`viw_${table.id().toString()}/`)
    );
    expect(standaloneChange?.options).toEqual({ version: 12 });
    expect(standaloneChange?.change).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['filter'], value: filter }),
        expect.objectContaining({ path: ['sort'], value: sort }),
        expect.objectContaining({ path: ['group'], value: group }),
      ])
    );
  });

  it('projects a cleared View sort to the legacy standalone View property', async () => {
    const originalTable = buildTable('s', 'c', 'r');
    const targetView = originalTable.views()[0]!;
    const sort = {
      sortObjs: [{ fieldId: originalTable.primaryFieldId().toString(), order: 'asc' as const }],
    };
    const sorted = originalTable.updateViewSort(targetView.id(), sort)._unsafeUnwrap().updateResult!
      .table;
    const cleared = sorted.updateViewSort(targetView.id(), null)._unsafeUnwrap().updateResult!
      .table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(cleared);
    const projection = new ViewSortUpdatedRealtimeProjection(
      engine,
      repository,
      new DefaultTableMapper()
    );
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewSortUpdated.create({
      baseId: cleared.baseId(),
      tableId: cleared.id(),
      viewId: targetView.id(),
      previousSort: sort,
      nextSort: null,
      oldVersion: 15,
      newVersion: 16,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual([
      { type: 'set', path: ['views', 0, 'query'], value: {} },
    ]);
    expect(engine.changes[1]?.change).toEqual(
      expect.arrayContaining([{ type: 'set', path: ['sort'], value: undefined, oldValue: sort }])
    );
  });

  it('projects a cleared View group to the legacy standalone View property', async () => {
    const originalTable = buildTable('g', 'c', 'r');
    const targetView = originalTable.views()[0]!;
    const group = [{ fieldId: originalTable.primaryFieldId().toString(), order: 'asc' as const }];
    const grouped = originalTable.updateViewGroup(targetView.id(), group)._unsafeUnwrap()
      .updateResult!.table;
    const cleared = grouped.updateViewGroup(targetView.id(), null)._unsafeUnwrap().updateResult!
      .table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(cleared);
    const projection = new ViewGroupUpdatedRealtimeProjection(
      engine,
      repository,
      new DefaultTableMapper()
    );
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewGroupUpdated.create({
      baseId: cleared.baseId(),
      tableId: cleared.id(),
      viewId: targetView.id(),
      previousGroup: group,
      nextGroup: null,
      oldVersion: 16,
      newVersion: 17,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual([
      { type: 'set', path: ['views', 0, 'query'], value: {} },
    ]);
    expect(engine.changes[1]?.change).toEqual(
      expect.arrayContaining([{ type: 'set', path: ['group'], value: undefined, oldValue: group }])
    );
  });

  it('projects View options to Table and standalone View documents', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const nextOptions = { rowHeight: 'tall', fieldNameDisplayLines: 2 };
    const updated = originalTable.updateViewOptions(targetView.id(), nextOptions)._unsafeUnwrap()
      .updateResult!.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewOptionsUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewOptionsUpdated.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousOptions: undefined,
      nextOptions,
      oldVersion: 15,
      newVersion: 16,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures.map(({ docId }) => docId.toString())).toEqual([
      `tbl_${updated.baseId().toString()}/${updated.id().toString()}`,
      `viw_${updated.id().toString()}/${targetView.id().toString()}`,
    ]);
    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['views', 0, 'options'],
        value: nextOptions,
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      {
        type: 'set',
        path: ['options'],
        value: nextOptions,
      },
    ]);
    expect(engine.changes[1]?.options).toEqual({ version: 15 });
  });

  it('projects View share metadata to Table and standalone View documents', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const nextShareMeta = { allowCopy: true, submit: { requireLogin: true } };
    const updated = originalTable
      .updateViewShareMeta(targetView.id(), nextShareMeta)
      ._unsafeUnwrap().updateResult!.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewShareMetaUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewShareMetaUpdated.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousShareMeta: undefined,
      nextShareMeta,
      oldVersion: 16,
      newVersion: 17,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['views', 0, 'shareMeta'],
        value: nextShareMeta,
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      {
        type: 'set',
        path: ['shareMeta'],
        value: nextShareMeta,
      },
    ]);
    expect(engine.changes[1]?.options).toEqual({ version: 16 });
  });

  it('projects only the current View share password metadata after replacement', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const previousShareMeta = { password: 'previous-password', allowCopy: false };
    const nextShareMeta = { password: 'current-password', allowCopy: true };
    const withPreviousShareMeta = originalTable
      .updateViewShareMeta(targetView.id(), previousShareMeta)
      ._unsafeUnwrap().updateResult!.table;
    const updated = withPreviousShareMeta
      .updateViewShareMeta(targetView.id(), nextShareMeta)
      ._unsafeUnwrap().updateResult!.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewShareMetaUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewShareMetaUpdated.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousShareMeta,
      nextShareMeta,
      oldVersion: 17,
      newVersion: 18,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['views', 0, 'shareMeta'],
        value: nextShareMeta,
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      {
        type: 'set',
        path: ['shareMeta'],
        value: nextShareMeta,
      },
    ]);
    expect(
      JSON.stringify({
        ensures: engine.ensures.map(({ initial }) => initial),
        changes: engine.changes.map(({ change }) => change),
      })
    ).not.toContain(previousShareMeta.password);
  });

  it('projects a refreshed View share ID to Table and standalone View documents', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const enabled = originalTable.enableViewShare(targetView.id())._unsafeUnwrap();
    const previousShareId = enabled.shareId;
    const nextShareId = `shr${'b'.repeat(16)}`;
    const updated = TableUpdateViewShareIdSpec.create(targetView.id(), previousShareId, nextShareId)
      .mutate(enabled.updateResult.table)
      ._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewShareIdRefreshedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewShareIdRefreshed.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousShareId,
      nextShareId,
      oldVersion: 17,
      newVersion: 18,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['views', 0, 'shareId'],
        value: nextShareId,
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      {
        type: 'set',
        path: ['shareId'],
        value: nextShareId,
      },
    ]);
    expect(engine.changes[1]?.options).toEqual({ version: 17 });
    expect(
      JSON.stringify({
        ensures: engine.ensures.map(({ initial }) => initial),
        changes: engine.changes.map(({ change }) => change),
      })
    ).not.toContain(previousShareId);
  });

  it('projects an enabled View share state to Table and standalone View documents', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const enabled = originalTable.enableViewShare(targetView.id())._unsafeUnwrap();
    const updated = enabled.updateResult.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewShareEnabledRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewShareEnabled.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      shareId: enabled.shareId,
      shareMeta: enabled.view.shareMeta()!,
      oldVersion: 18,
      newVersion: 19,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['views', 0, 'enableShare'],
        value: true,
      },
      {
        type: 'set',
        path: ['views', 0, 'shareId'],
        value: enabled.shareId,
      },
      {
        type: 'set',
        path: ['views', 0, 'shareMeta'],
        value: { includeRecords: true },
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      { type: 'set', path: ['enableShare'], value: true },
      { type: 'set', path: ['shareId'], value: enabled.shareId },
      { type: 'set', path: ['shareMeta'], value: { includeRecords: true } },
    ]);
    expect(engine.changes[1]?.options).toEqual({ version: 18 });
  });

  it('projects only the newly issued credential when re-enabling View sharing', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const firstEnabled = originalTable.enableViewShare(targetView.id())._unsafeUnwrap();
    const disabled = firstEnabled.updateResult.table
      .disableViewShare(targetView.id())
      ._unsafeUnwrap();
    const reenabled = disabled.updateResult.table.enableViewShare(targetView.id())._unsafeUnwrap();
    const updated = reenabled.updateResult.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewShareEnabledRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewShareEnabled.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      shareId: reenabled.shareId,
      shareMeta: reenabled.view.shareMeta()!,
      oldVersion: 20,
      newVersion: 21,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(reenabled.shareId).not.toBe(firstEnabled.shareId);
    expect(engine.changes[0]?.change).toEqual([
      { type: 'set', path: ['views', 0, 'enableShare'], value: true },
      {
        type: 'set',
        path: ['views', 0, 'shareId'],
        value: reenabled.shareId,
      },
      {
        type: 'set',
        path: ['views', 0, 'shareMeta'],
        value: { includeRecords: true },
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      { type: 'set', path: ['enableShare'], value: true },
      { type: 'set', path: ['shareId'], value: reenabled.shareId },
      { type: 'set', path: ['shareMeta'], value: { includeRecords: true } },
    ]);
    expect(
      JSON.stringify({
        ensures: engine.ensures.map(({ initial }) => initial),
        changes: engine.changes.map(({ change }) => change),
      })
    ).not.toContain(firstEnabled.shareId);
  });

  it('projects a disabled View share state while retaining its credential metadata', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const enabled = originalTable.enableViewShare(targetView.id())._unsafeUnwrap();
    const disabled = enabled.updateResult.table.disableViewShare(targetView.id())._unsafeUnwrap();
    const updated = disabled.updateResult.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewShareDisabledRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewShareDisabled.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousShareId: enabled.shareId,
      shareMeta: disabled.view.shareMeta(),
      oldVersion: 19,
      newVersion: 20,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['views', 0, 'enableShare'],
        value: false,
      },
      {
        type: 'set',
        path: ['views', 0, 'shareId'],
        value: enabled.shareId,
      },
      {
        type: 'set',
        path: ['views', 0, 'shareMeta'],
        value: { includeRecords: true },
      },
    ]);
    expect(engine.changes[1]?.change).toEqual([
      { type: 'set', path: ['enableShare'], value: false },
      { type: 'set', path: ['shareId'], value: enabled.shareId },
      { type: 'set', path: ['shareMeta'], value: { includeRecords: true } },
    ]);
    expect(engine.changes[1]?.options).toEqual({ version: 19 });
  });

  it('projects View locked state to Table and standalone View documents with persisted version', async () => {
    const originalTable = buildTable('x', 'y', 'z');
    const targetView = originalTable.views()[0]!;
    const updated = originalTable.updateViewLocked(targetView.id(), true)._unsafeUnwrap()
      .updateResult.table;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(updated);
    const mapper = new DefaultTableMapper();
    const projection = new ViewLockedUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewLockedUpdated.create({
      baseId: updated.baseId(),
      tableId: updated.id(),
      viewId: targetView.id(),
      previousIsLocked: undefined,
      nextIsLocked: true,
      oldVersion: 13,
      newVersion: 14,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures.map(({ docId }) => docId.toString())).toEqual([
      `tbl_${updated.baseId().toString()}/${updated.id().toString()}`,
      `viw_${updated.id().toString()}/${targetView.id().toString()}`,
    ]);
    expect(engine.changes[0]).toMatchObject({
      change: {
        type: 'set',
        path: ['views', 0, 'isLocked'],
        value: true,
        oldValue: undefined,
      },
    });
    expect(engine.changes[1]?.change).toEqual({
      type: 'set',
      path: ['isLocked'],
      value: true,
      oldValue: undefined,
    });
    expect(engine.changes[1]?.options).toEqual({ version: 13 });
  });

  it('advances the standalone View version for an unchanged omitted locked state', async () => {
    const table = buildTable('l', 'm', 'n');
    const targetView = table.views()[0]!;
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new DefaultTableMapper();
    const projection = new ViewLockedUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewLockedUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      viewId: targetView.id(),
      previousIsLocked: undefined,
      nextIsLocked: undefined,
      oldVersion: 14,
      newVersion: 15,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.change).toEqual({
      type: 'set',
      path: ['id'],
      value: targetView.id().toString(),
      oldValue: targetView.id().toString(),
    });
    expect(engine.changes[0]?.options).toEqual({ version: 14 });
  });

  it('projects View order to Table and standalone View documents with persisted version', async () => {
    const table = buildTable('o', 'p', 'q');
    const targetView = table.views()[0]!;
    targetView.setOrder(ViewOrder.rehydrate(2.5)._unsafeUnwrap())._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new DefaultTableMapper();
    const projection = new ViewOrderUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();
    const event = ViewOrderUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      viewId: targetView.id(),
      previousOrder: ViewOrder.rehydrate(3)._unsafeUnwrap(),
      nextOrder: ViewOrder.rehydrate(2.5)._unsafeUnwrap(),
      oldVersion: 15,
      newVersion: 16,
    });

    (await projection.handle(createContext(), event))._unsafeUnwrap();
    await realtimeTasks[0]!();

    expect(engine.changes[0]?.change).toEqual({
      type: 'set',
      path: ['views', 0, 'order'],
      value: 2.5,
      oldValue: 3,
    });
    expect(engine.changes[1]?.change).toEqual({
      type: 'set',
      path: ['order'],
      value: 2.5,
      oldValue: 3,
    });
    expect(engine.changes[1]?.options).toEqual({ version: 15 });
  });

  it('updates view column meta when view exists', async () => {
    const table = buildTable('c', 'd', 'e');
    const viewId = table.views()[0]?.id() ?? ViewId.create(`viw${'a'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new ViewColumnMetaUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();

    const event = ViewColumnMetaUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      viewId,
      fieldId: table.primaryFieldId(),
      oldVersion: 7,
      newVersion: 8,
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(0);
    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures).toHaveLength(2);
    expect(engine.ensures[0]?.docId.toString()).toBe(
      `tbl_${table.baseId().toString()}/${table.id().toString()}`
    );
    expect(engine.ensures[1]?.docId.toString()).toBe(
      `viw_${table.id().toString()}/${viewId.toString()}`
    );
    expect(engine.changes).toHaveLength(2);
    expect(engine.changes[0]?.docId.toString()).toBe(
      `tbl_${table.baseId().toString()}/${table.id().toString()}`
    );
    expect(engine.changes[1]?.docId.toString()).toBe(
      `viw_${table.id().toString()}/${viewId.toString()}`
    );
    expect(engine.changes[1]?.change).toEqual([
      {
        type: 'set',
        path: ['columnMeta'],
        value: buildTableDto(table).views[0]?.columnMeta,
      },
    ]);
    expect(engine.changes[1]?.options).toEqual({ version: 7 });
  });

  it('coalesces pending view column meta realtime updates for the same view', async () => {
    const table = buildTable('c', 'd', 'v');
    const viewId = table.views()[0]?.id() ?? ViewId.create(`viw${'v'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new ViewColumnMetaUpdatedRealtimeProjection(engine, repository, mapper);
    const context = createContext();
    const dispatchScope = createEventDispatchScope();
    const realtimeTasks = captureRealtimeTasks();

    const firstResult = await projection.handle(
      context,
      ViewColumnMetaUpdated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        viewId,
        fieldId: table.primaryFieldId(),
        oldVersion: 7,
        newVersion: 8,
      }),
      dispatchScope
    );
    const secondResult = await projection.handle(
      context,
      ViewColumnMetaUpdated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        viewId,
        fieldId: table.primaryFieldId(),
        oldVersion: 8,
        newVersion: 9,
      }),
      dispatchScope
    );

    firstResult._unsafeUnwrap();
    secondResult._unsafeUnwrap();

    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(repository.findOneCount).toBe(1);
    expect(engine.changes).toHaveLength(2);
    expect(engine.changes[1]?.options).toEqual({ version: 7 });
  });

  it('reuses a cached snapshot for repeated view column meta updates after a field is deleted', async () => {
    const table = buildTable('c', 'd', 'w');
    const viewId = table.views()[0]?.id() ?? ViewId.create(`viw${'w'.repeat(16)}`)._unsafeUnwrap();
    const deletedFieldId = FieldId.create(`fld${'w'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new ViewColumnMetaUpdatedRealtimeProjection(engine, repository, mapper);
    const context = createContext();
    const dispatchScope = createEventDispatchScope();
    const realtimeTasks = captureRealtimeTasks();

    const firstResult = await projection.handle(
      context,
      ViewColumnMetaUpdated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        viewId,
        fieldId: deletedFieldId,
      }),
      dispatchScope
    );
    firstResult._unsafeUnwrap();
    await realtimeTasks.shift()!();

    const secondResult = await projection.handle(
      context,
      ViewColumnMetaUpdated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        viewId,
        fieldId: deletedFieldId,
      }),
      dispatchScope
    );
    secondResult._unsafeUnwrap();
    await realtimeTasks.shift()!();

    expect(repository.findOneCount).toBe(1);
  });

  it('reuses a table snapshot across field create realtime projections in one context', async () => {
    const table = buildTable('c', 'd', 'f');
    const viewId = table.views()[0]?.id() ?? ViewId.create(`viw${'b'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const fieldProjection = new FieldCreatedRealtimeProjection(engine, repository, mapper);
    const viewProjection = new ViewColumnMetaUpdatedRealtimeProjection(engine, repository, mapper);
    const context = createContext();
    const dispatchScope = createEventDispatchScope();
    const realtimeTasks = captureRealtimeTasks();

    const fieldResult = await fieldProjection.handle(
      context,
      FieldCreated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        fieldId: table.primaryFieldId(),
      }),
      dispatchScope
    );
    fieldResult._unsafeUnwrap();

    expect(repository.findOneCount).toBe(0);
    await realtimeTasks.shift()!();

    const viewResult = await viewProjection.handle(
      context,
      ViewColumnMetaUpdated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        viewId,
        fieldId: table.primaryFieldId(),
      }),
      dispatchScope
    );
    viewResult._unsafeUnwrap();

    await realtimeTasks.shift()!();

    expect(repository.findOneCount).toBe(1);
  });

  it('reuses a deleted-field table snapshot across view column meta projections in one context', async () => {
    const table = buildTable('c', 'd', 'j');
    const viewId = table.views()[0]?.id() ?? ViewId.create(`viw${'j'.repeat(16)}`)._unsafeUnwrap();
    const firstDeletedFieldId = table.primaryFieldId();
    const secondDeletedFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(() => {
      const base = buildTableDto(table);
      return {
        ...base,
        fields: [],
        views: base.views.map((view) => ({
          ...view,
          columnMeta: {},
        })),
      };
    });
    const projection = new ViewColumnMetaUpdatedRealtimeProjection(engine, repository, mapper);
    const context = createContext();
    const dispatchScope = createEventDispatchScope();
    const realtimeTasks = captureRealtimeTasks();

    const firstResult = await projection.handle(
      context,
      ViewColumnMetaUpdated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        viewId,
        fieldId: firstDeletedFieldId,
        fieldInColumnMeta: false,
      }),
      dispatchScope
    );
    firstResult._unsafeUnwrap();
    await realtimeTasks.shift()!();

    const secondResult = await projection.handle(
      context,
      ViewColumnMetaUpdated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        viewId,
        fieldId: secondDeletedFieldId,
        fieldInColumnMeta: false,
      }),
      dispatchScope
    );
    secondResult._unsafeUnwrap();
    await realtimeTasks.shift()!();

    expect(repository.findOneCount).toBe(1);
  });

  it('deduplicates concurrent table snapshot loads across field create realtime projections', async () => {
    const table = buildTable('c', 'd', 'i');
    const viewId = table.views()[0]?.id() ?? ViewId.create(`viw${'c'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    let releaseFindOne!: () => void;
    repository.findOneDeferred = {
      promise: new Promise<void>((resolve) => {
        releaseFindOne = resolve;
      }),
      resolve: () => releaseFindOne(),
    };
    const mapper = new FakeTableMapper(buildTableDto);
    const fieldProjection = new FieldCreatedRealtimeProjection(engine, repository, mapper);
    const viewProjection = new ViewColumnMetaUpdatedRealtimeProjection(engine, repository, mapper);
    const context = createContext();
    const dispatchScope = createEventDispatchScope();
    const realtimeTasks = captureRealtimeTasks();

    const fieldResult = await fieldProjection.handle(
      context,
      FieldCreated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        fieldId: table.primaryFieldId(),
      }),
      dispatchScope
    );
    fieldResult._unsafeUnwrap();
    const viewResult = await viewProjection.handle(
      context,
      ViewColumnMetaUpdated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        viewId,
        fieldId: table.primaryFieldId(),
      }),
      dispatchScope
    );
    viewResult._unsafeUnwrap();

    const runningTasks = realtimeTasks.map((task) => task());
    await Promise.resolve();

    expect(repository.findOneCount).toBe(1);

    repository.findOneDeferred.resolve();
    await Promise.all(runningTasks);

    expect(repository.findOneCount).toBe(1);
    expect(engine.ensures.length).toBeGreaterThanOrEqual(3);
  });

  it('refreshes a cached table snapshot when a later field create needs a newer field', async () => {
    const table = buildTable('c', 'd', 'g');
    const firstFieldId = table.primaryFieldId();
    const secondFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(() => {
      const base = buildTableDto(table);
      if (repository.findOneCount < 2) {
        return base;
      }

      return {
        ...base,
        fields: [
          ...base.fields,
          {
            id: secondFieldId.toString(),
            name: 'Notes',
            type: 'longText',
          },
        ],
        views: base.views.map((view) => ({
          ...view,
          columnMeta: {
            ...view.columnMeta,
            [secondFieldId.toString()]: { order: 1 },
          },
        })),
      };
    });
    const projection = new FieldCreatedRealtimeProjection(engine, repository, mapper);
    const context = createContext();
    const dispatchScope = createEventDispatchScope();
    const realtimeTasks = captureRealtimeTasks();

    const firstResult = await projection.handle(
      context,
      FieldCreated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        fieldId: firstFieldId,
      }),
      dispatchScope
    );
    firstResult._unsafeUnwrap();
    await realtimeTasks.shift()!();

    const secondResult = await projection.handle(
      context,
      FieldCreated.create({
        baseId: table.baseId(),
        tableId: table.id(),
        fieldId: secondFieldId,
      }),
      dispatchScope
    );
    secondResult._unsafeUnwrap();
    await realtimeTasks.shift()!();

    expect(repository.findOneCount).toBe(2);
    expect(engine.ensures.at(-1)?.initial).toMatchObject({
      id: secondFieldId.toString(),
      name: 'Notes',
    });
  });

  it('ignores missing views', async () => {
    const table = buildTable('f', 'g', 'h');
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new ViewColumnMetaUpdatedRealtimeProjection(engine, repository, mapper);
    const realtimeTasks = captureRealtimeTasks();

    const event = ViewColumnMetaUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      viewId: ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap(),
      fieldId: table.primaryFieldId(),
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(realtimeTasks).toHaveLength(1);
    await realtimeTasks[0]!();

    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(0);
  });

  it('projects field options addition with incremental change', async () => {
    const baseId = BaseId.create(`bse${'o'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'p'.repeat(16)}`)._unsafeUnwrap();
    const tableName = TableName.create('Table P')._unsafeUnwrap();
    const fieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
    const fieldName = FieldName.create('Status')._unsafeUnwrap();

    const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
    builder.field().singleSelect().withId(fieldId).withName(fieldName).primary().done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((t) => ({
      ...buildTableDto(t),
      fields: [
        {
          id: fieldId.toString(),
          name: 'Status',
          type: 'singleSelect' as const,
          options: {
            choices: [
              { id: 'opt1', name: 'Option A', color: 'blue' },
              { id: 'opt2', name: 'Option B', color: 'red' },
              { id: 'opt3', name: 'Option C', color: 'green' },
            ],
          },
        },
      ],
    }));
    const projection = new FieldOptionsAddedRealtimeProjection(engine, repository, mapper);

    const newOptions = [
      SelectOption.create({ id: 'opt3', name: 'Option C', color: 'green' })._unsafeUnwrap(),
    ];
    const event = FieldOptionsAdded.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId,
      options: newOptions,
      oldVersion: 7,
      newVersion: 8,
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    // Should NOT call ensure() - only applyChange() for incremental updates
    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.change).toEqual({
      type: 'set',
      path: ['options'],
      value: {
        choices: [
          { id: 'opt1', name: 'Option A', color: 'blue' },
          { id: 'opt2', name: 'Option B', color: 'red' },
          { id: 'opt3', name: 'Option C', color: 'green' },
        ],
      },
    });
    expect(engine.changes[0]?.options).toEqual({ version: 7 });
  });

  it('handles missing field gracefully for field options added', async () => {
    const table = buildTable('r', 's', 't');
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((t) => ({
      ...buildTableDto(t),
      fields: [], // No fields in snapshot
    }));
    const projection = new FieldOptionsAddedRealtimeProjection(engine, repository, mapper);

    const nonExistentFieldId = FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap();
    const event = FieldOptionsAdded.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId: nonExistentFieldId,
      options: [],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    // Should skip silently without errors
    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(0);
  });

  it('projects field updates by replacing field document snapshot', async () => {
    const table = buildTable('2', '3', '4');
    const fieldId = table.primaryFieldId();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [
        {
          id: fieldId.toString(),
          name: 'Renamed',
          type: 'singleLineText',
          notNull: true,
        },
      ],
    }));
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId,
      updatedProperties: ['name', 'notNull'],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.change).toEqual([
      { type: 'set', path: ['name'], value: 'Renamed' },
      { type: 'set', path: ['notNull'], value: true },
    ]);
  });

  it('applies field update with event oldVersion', async () => {
    const table = buildTable('f', 'g', 'h');
    const fieldId = table.primaryFieldId();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [
        {
          id: fieldId.toString(),
          name: 'Renamed',
          type: 'singleLineText',
        },
      ],
    }));
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId,
      updatedProperties: ['name'],
      changes: {
        name: { oldValue: 'Title', newValue: 'Renamed' },
      },
      oldVersion: 4,
      newVersion: 5,
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.options).toEqual({ version: 4 });
  });

  it('projects field updates using snapshot value when event changes provided', async () => {
    const table = buildTable('2', '3', '4');
    const fieldId = table.primaryFieldId();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [
        {
          id: fieldId.toString(),
          name: 'Renamed',
          type: 'singleSelect',
          options: { choices: [{ id: 'opt1', name: 'Open', color: 'yellowBright' }] },
        },
      ],
    }));
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId,
      updatedProperties: ['type'],
      changes: {
        type: { oldValue: 'singleLineText', newValue: 'singleSelect' },
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.change).toEqual([
      { type: 'set', path: ['type'], value: 'singleSelect', oldValue: 'singleLineText' },
    ]);
  });

  it('uses hydrated snapshot options instead of stale event options change', async () => {
    const table = buildTable('7', '8', '9');
    const fieldId = table.primaryFieldId();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [
        {
          id: fieldId.toString(),
          name: 'Status',
          type: 'singleSelect',
          options: {
            choices: [{ id: 'opt1', name: 'Open', color: 'yellowBright' }],
          },
        },
      ],
    }));
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId,
      updatedProperties: ['type', 'options'],
      changes: {
        type: { oldValue: 'singleLineText', newValue: 'singleSelect' },
        options: { oldValue: {}, newValue: {} },
      },
      propertySemantics: {
        type: fieldUpdateSemantics.type,
        options: fieldUpdateSemantics.options,
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.change).toEqual([
      { type: 'set', path: ['type'], value: 'singleSelect', oldValue: 'singleLineText' },
      {
        type: 'set',
        path: ['options'],
        value: {
          choices: [{ id: 'opt1', name: 'Open', color: 'yellowBright' }],
        },
        oldValue: {},
      },
    ]);
  });

  it('hydrates field shape metadata for type conversions that change computed value types', async () => {
    const table = buildTable('9', 'a', 'b');
    const fieldId = table.primaryFieldId();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [
        {
          id: fieldId.toString(),
          name: 'Score',
          type: 'formula',
          isComputed: true,
          cellValueType: 'number',
          isMultipleCellValue: false,
          options: {
            expression: '{fldSource0000000001} * 4',
            formatting: {
              type: 'decimal',
              precision: 2,
            },
          },
        },
      ],
    }));
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId,
      updatedProperties: ['type', 'options'],
      changes: {
        type: { oldValue: 'singleLineText', newValue: 'formula' },
        options: {
          oldValue: {},
          newValue: {
            expression: '{fldSource0000000001} * 4',
            formatting: {
              type: 'decimal',
              precision: 2,
            },
          },
        },
      },
      propertySemantics: {
        type: fieldUpdateSemantics.type,
        options: fieldUpdateSemantics.options,
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.change).toEqual([
      { type: 'set', path: ['type'], value: 'formula', oldValue: 'singleLineText' },
      {
        type: 'set',
        path: ['options'],
        value: {
          expression: '{fldSource0000000001} * 4',
          formatting: {
            type: 'decimal',
            precision: 2,
          },
        },
        oldValue: {},
      },
      { type: 'set', path: ['isComputed'], value: true },
      { type: 'set', path: ['isLookup'], value: null },
      { type: 'set', path: ['isConditionalLookup'], value: null },
      { type: 'set', path: ['lookupOptions'], value: null },
      { type: 'set', path: ['cellValueType'], value: 'number' },
      { type: 'set', path: ['isMultipleCellValue'], value: false },
      { type: 'set', path: ['config'], value: null },
      { type: 'set', path: ['innerType'], value: null },
      { type: 'set', path: ['innerOptions'], value: null },
    ]);
  });

  it('hydrates link multiplicity metadata when relationship updates change cell shape', async () => {
    const baseId = BaseId.create(`bse${'l'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'m'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'n'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
    const tableName = TableName.create('Link Table')._unsafeUnwrap();
    const primaryFieldName = FieldName.create('Title')._unsafeUnwrap();
    const linkFieldName = FieldName.create('Teaching Point')._unsafeUnwrap();
    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      isOneWay: false,
    })._unsafeUnwrap();

    const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(primaryFieldName)
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(linkFieldName)
      .withConfig(linkConfig)
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new DefaultTableMapper();
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId: linkFieldId,
      updatedProperties: ['linkRelationship'],
      changes: {
        linkRelationship: {
          oldValue: {
            relationship: 'oneMany',
            foreignTableId: foreignTableId.toString(),
            lookupFieldId: lookupFieldId.toString(),
            isOneWay: true,
          },
          newValue: {
            relationship: 'manyOne',
            foreignTableId: foreignTableId.toString(),
            lookupFieldId: lookupFieldId.toString(),
            isOneWay: false,
          },
        },
      },
      propertySemantics: {
        linkRelationship: fieldUpdateSemantics.options,
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.changes).toHaveLength(1);
    const changes = engine.changes[0]?.change;
    expect(Array.isArray(changes)).toBe(true);
    expect(changes).toEqual(
      expect.arrayContaining([
        {
          type: 'set',
          path: ['options'],
          value: expect.objectContaining({
            relationship: 'manyOne',
            foreignTableId: foreignTableId.toString(),
            lookupFieldId: lookupFieldId.toString(),
            isOneWay: false,
          }),
        },
        { type: 'set', path: ['isComputed'], value: null },
        { type: 'set', path: ['isLookup'], value: null },
        { type: 'set', path: ['isConditionalLookup'], value: null },
        { type: 'set', path: ['lookupOptions'], value: null },
        { type: 'set', path: ['cellValueType'], value: 'string' },
        { type: 'set', path: ['isMultipleCellValue'], value: false },
        { type: 'set', path: ['config'], value: null },
        { type: 'set', path: ['innerType'], value: null },
        { type: 'set', path: ['innerOptions'], value: null },
      ])
    );
  });

  it('refreshes enriched lookupOptions, cellValueType and inner type/options on a lookup change', async () => {
    const baseId = BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'t'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'u'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'v'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'w'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'x'.repeat(16)}`)._unsafeUnwrap();
    const foreignTargetFieldId = FieldId.create(`fld${'y'.repeat(16)}`)._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignTargetFieldId.toString(),
    })._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Lookup Table')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Link')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    builder
      .field()
      .lookup()
      .withId(lookupFieldId)
      .withName(FieldName.create('Lookup Amount')._unsafeUnwrap())
      .withInnerField(
        NumberField.create({
          id: FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap(),
          name: FieldName.create('Amount')._unsafeUnwrap(),
          formatting: NumberFormatting.create({ type: 'decimal', precision: 2 })._unsafeUnwrap(),
        })._unsafeUnwrap()
      )
      .withLookupOptions(
        LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignTargetFieldId.toString(),
        })._unsafeUnwrap()
      )
      .withIsMultipleCellValue(false)
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new DefaultTableMapper();
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId: lookupFieldId,
      updatedProperties: ['lookupOptions'],
      propertySemantics: {
        lookupOptions: fieldUpdateSemantics.lookupOptions,
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.changes).toHaveLength(1);
    const changes = engine.changes[0]?.change as RealtimeChange[];

    // lookupOptions must be published WITH the link's physical metadata (regression: was dropped).
    const lookupOptionsChange = changes.find(
      (change) => JSON.stringify(change.path) === JSON.stringify(['lookupOptions'])
    );
    expect(lookupOptionsChange).toEqual(
      expect.objectContaining({
        type: 'set',
        value: expect.objectContaining({
          linkFieldId: linkFieldId.toString(),
          lookupFieldId: foreignTargetFieldId.toString(),
          foreignTableId: foreignTableId.toString(),
          fkHostTableName: expect.any(String),
          selfKeyName: expect.any(String),
          foreignKeyName: expect.any(String),
        }),
      })
    );

    // cellValueType must be the resolved inner type, never null (regression: was null).
    expect(changes).toContainEqual({ type: 'set', path: ['cellValueType'], value: 'number' });
    // The resolved inner type/options must refresh so changing the looked-up field is reflected
    // (dbFieldType, when carried by the persisted snapshot, goes through the same scalar path).
    expect(changes).toContainEqual({ type: 'set', path: ['type'], value: 'number' });
    expect(
      changes.some((change) => JSON.stringify(change.path) === JSON.stringify(['options']))
    ).toBe(true);
  });

  it('clears stale inner options and skips absent storage metadata when a lookup is pending', async () => {
    const table = buildTable('p', 'q', 'r');
    const fieldId = table.primaryFieldId();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    // A pending lookup (inner field unresolved) falls back to singleLineText and omits both
    // `options` and `dbFieldType` from its DTO.
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [
        {
          id: fieldId.toString(),
          name: 'Pending Lookup',
          type: 'singleLineText',
          isLookup: true,
          isComputed: true,
          lookupOptions: {
            linkFieldId: `fld${'k'.repeat(16)}`,
            lookupFieldId: `fld${'l'.repeat(16)}`,
            foreignTableId: `tbl${'m'.repeat(16)}`,
          },
        },
      ],
    }));
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId,
      updatedProperties: ['lookupOptions'],
      propertySemantics: { lookupOptions: fieldUpdateSemantics.lookupOptions },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    const changes = engine.changes[0]?.change as RealtimeChange[];
    // Stale inner options (e.g. previous number formatting) are cleared, not left untouched.
    expect(changes).toContainEqual({ type: 'set', path: ['options'], value: {} });
    expect(changes).toContainEqual({ type: 'set', path: ['type'], value: 'singleLineText' });
    // dbFieldType is absent from the pending snapshot → must NOT publish a null that corrupts it.
    expect(
      changes.some((change) => JSON.stringify(change.path) === JSON.stringify(['dbFieldType']))
    ).toBe(false);
  });

  it('projects formatting-only field updates through the field options snapshot', async () => {
    const table = buildTable('1', '2', '3');
    const fieldId = table.primaryFieldId();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [
        {
          id: fieldId.toString(),
          name: 'Event Time',
          type: 'date',
          options: {
            formatting: {
              date: 'YYYY-MM-DD',
              time: 'hh:mm A',
              timeZone: 'UTC',
            },
          },
        },
      ],
    }));
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId,
      updatedProperties: ['formatting'],
      changes: {
        formatting: {
          oldValue: {
            date: 'YYYY-MM-DD',
            time: 'None',
            timeZone: 'UTC',
          },
          newValue: {
            date: 'YYYY-MM-DD',
            time: 'hh:mm A',
            timeZone: 'UTC',
          },
        },
      },
      propertySemantics: {
        formatting: fieldUpdateSemantics.formatting,
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.changes).toHaveLength(1);
    expect(engine.changes[0]?.change).toEqual([
      {
        type: 'set',
        path: ['options'],
        value: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'hh:mm A',
            timeZone: 'UTC',
          },
        },
      },
    ]);
  });

  it('skips field updated projection when field is missing in snapshot', async () => {
    const table = buildTable('5', '6', '7');
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [],
    }));
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId: table.primaryFieldId(),
      updatedProperties: ['name'],
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(0);
  });

  it('generates FieldOptionsAdded event from spec visitor', () => {
    const baseId = BaseId.create(`bse${'v'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'w'.repeat(16)}`)._unsafeUnwrap();
    const tableName = TableName.create('Table W')._unsafeUnwrap();
    const fieldId = FieldId.create(`fld${'x'.repeat(16)}`)._unsafeUnwrap();
    const fieldName = FieldName.create('Category')._unsafeUnwrap();

    const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
    builder.field().singleSelect().withId(fieldId).withName(fieldName).primary().done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const options = [
      SelectOption.create({ id: 'opt1', name: 'Alpha', color: 'blue' })._unsafeUnwrap(),
      SelectOption.create({ id: 'opt2', name: 'Beta', color: 'red' })._unsafeUnwrap(),
    ];

    const spec = TableAddSelectOptionsSpec.create(fieldId, options);
    const visitor = new TableEventGeneratingSpecVisitor(table);
    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events).toHaveLength(1);

    const event = events[0] as FieldOptionsAdded;
    expect(event.name.toString()).toBe('FieldOptionsAdded');
    expect(event.tableId.toString()).toBe(tableId.toString());
    expect(event.baseId.toString()).toBe(baseId.toString());
    expect(event.fieldId.toString()).toBe(fieldId.toString());
    expect(event.options).toEqual([
      { id: 'opt1', name: 'Alpha', color: 'blue' },
      { id: 'opt2', name: 'Beta', color: 'red' },
    ]);
  });

  it('generates FieldUpdated event with type AND options changes for type conversion', () => {
    const baseId = BaseId.create(`bse${'m'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'n'.repeat(16)}`)._unsafeUnwrap();
    const tableName = TableName.create('Table N')._unsafeUnwrap();
    const fieldId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();
    const fieldName = FieldName.create('Category')._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldName = FieldName.create('Title')._unsafeUnwrap();

    const options = [
      SelectOption.create({ id: 'opt1', name: 'Alpha', color: 'blue' })._unsafeUnwrap(),
      SelectOption.create({ id: 'opt2', name: 'Beta', color: 'red' })._unsafeUnwrap(),
    ];

    // Build a table with a singleSelect field (the old field)
    const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(primaryFieldName)
      .primary()
      .done();
    builder.field().singleSelect().withId(fieldId).withName(fieldName).withOptions(options).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    // Get the old field (singleSelect)
    const oldField = table.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();

    // Build a new singleLineText field to convert to
    const newFieldBuilder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
    newFieldBuilder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(primaryFieldName)
      .primary()
      .done();
    newFieldBuilder.field().singleLineText().withId(fieldId).withName(fieldName).done();
    newFieldBuilder.view().defaultGrid().done();
    const newTable = newFieldBuilder.build()._unsafeUnwrap();
    const newField = newTable.getField((f) => f.id().equals(fieldId))._unsafeUnwrap();

    // Create the type conversion spec and visit
    const spec = TableUpdateFieldTypeSpec.create(oldField, newField);
    const visitor = new TableEventGeneratingSpecVisitor(table);
    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events).toHaveLength(1);

    const event = events[0] as FieldUpdated;
    expect(event.name.toString()).toBe('FieldUpdated');
    expect(event.updatedProperties).toContain('type');
    expect(event.updatedProperties).toContain('options');

    // Verify type change has old/new values
    expect(event.changes.type).toEqual({
      oldValue: 'singleSelect',
      newValue: 'singleLineText',
    });

    // Verify options change has old/new values (critical for action trigger alignment with v1)
    expect(event.changes.options).toBeDefined();
    expect(event.changes.options.oldValue).toEqual({
      choices: [
        { id: 'opt1', name: 'Alpha', color: 'blue' },
        { id: 'opt2', name: 'Beta', color: 'red' },
      ],
    });
    expect(event.changes.options.newValue).toEqual({});
  });

  it('projects field type conversion with incremental property-level changes', async () => {
    const table = buildTable('8', '9', 'a');
    const fieldId = table.primaryFieldId();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper((candidate) => ({
      ...buildTableDto(candidate),
      fields: [
        {
          id: fieldId.toString(),
          name: 'Category',
          type: 'singleLineText',
          dbFieldName: 'Category',
          dbFieldType: 'TEXT',
          options: {},
        },
      ],
    }));
    const projection = new FieldUpdatedRealtimeProjection(engine, repository, mapper);

    // Simulate a singleSelect → singleLineText type conversion event
    const event = FieldUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId,
      updatedProperties: ['type', 'options'],
      changes: {
        type: { oldValue: 'singleSelect', newValue: 'singleLineText' },
        options: {
          oldValue: {
            choices: [{ id: 'opt1', name: 'Alpha', color: 'blue' }],
          },
          newValue: {},
        },
      },
      propertySemantics: {
        type: fieldUpdateSemantics.type,
        options: fieldUpdateSemantics.options,
      },
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    // Must produce incremental property-level changes, NOT a full doc replace
    expect(engine.ensures).toHaveLength(0);
    expect(engine.changes).toHaveLength(1);

    const changes = engine.changes[0]?.change;
    expect(Array.isArray(changes)).toBe(true);
    const changeArray = changes as Array<{
      type: string;
      path: string[];
      value: unknown;
      oldValue?: unknown;
    }>;

    // Verify property-level paths (p:['type'], p:['options']) — NOT p:[] full doc replace
    expect(changeArray).toHaveLength(2);
    expect(changeArray[0]).toEqual({
      type: 'set',
      path: ['type'],
      value: 'singleLineText',
      oldValue: 'singleSelect',
    });
    expect(changeArray[1]).toEqual({
      type: 'set',
      path: ['options'],
      value: {},
      oldValue: {
        choices: [{ id: 'opt1', name: 'Alpha', color: 'blue' }],
      },
    });
  });

  it('does not generate event when options are empty', () => {
    const baseId = BaseId.create(`bse${'y'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'z'.repeat(16)}`)._unsafeUnwrap();
    const tableName = TableName.create('Table Z')._unsafeUnwrap();
    const fieldId = FieldId.create(`fld${'1'.repeat(16)}`)._unsafeUnwrap();
    const fieldName = FieldName.create('Empty')._unsafeUnwrap();

    const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
    builder.field().singleSelect().withId(fieldId).withName(fieldName).primary().done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const spec = TableAddSelectOptionsSpec.create(fieldId, []);
    const visitor = new TableEventGeneratingSpecVisitor(table);
    spec.accept(visitor)._unsafeUnwrap();

    const events = visitor.getEvents();
    expect(events).toHaveLength(0);
  });
});
