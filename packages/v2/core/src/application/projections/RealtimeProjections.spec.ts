import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { FieldCreated } from '../../domain/table/events/FieldCreated';
import { FieldDeleted } from '../../domain/table/events/FieldDeleted';
import { FieldOptionsAdded } from '../../domain/table/events/FieldOptionsAdded';
import { RecordCreated } from '../../domain/table/events/RecordCreated';
import { RecordsBatchCreated } from '../../domain/table/events/RecordsBatchCreated';
import { RecordsBatchUpdated } from '../../domain/table/events/RecordsBatchUpdated';
import { RecordsDeleted } from '../../domain/table/events/RecordsDeleted';
import { RecordUpdated } from '../../domain/table/events/RecordUpdated';
import { TableCreated } from '../../domain/table/events/TableCreated';
import { ViewColumnMetaUpdated } from '../../domain/table/events/ViewColumnMetaUpdated';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { SelectOption } from '../../domain/table/fields/types/SelectOption';
import { RecordId } from '../../domain/table/records/RecordId';
import { TableAddSelectOptionsSpec } from '../../domain/table/specs/TableAddSelectOptionsSpec';
import { TableEventGeneratingSpecVisitor } from '../../domain/table/specs/visitors/TableEventGeneratingSpecVisitor';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import { ViewId } from '../../domain/table/views/ViewId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableMapper, ITablePersistenceDTO } from '../../ports/mappers/TableMapper';
import type { RealtimeChange } from '../../ports/RealtimeChange';
import type { RealtimeDocId } from '../../ports/RealtimeDocId';
import type { IRealtimeEngine } from '../../ports/RealtimeEngine';
import type { ITableRepository } from '../../ports/TableRepository';
import { FieldCreatedRealtimeProjection } from './FieldCreatedRealtimeProjection';
import { FieldDeletedRealtimeProjection } from './FieldDeletedRealtimeProjection';
import { FieldOptionsAddedRealtimeProjection } from './FieldOptionsAddedRealtimeProjection';
import { RecordCreatedRealtimeProjection } from './RecordCreatedRealtimeProjection';
import { RecordsBatchCreatedRealtimeProjection } from './RecordsBatchCreatedRealtimeProjection';
import { RecordsBatchUpdatedRealtimeProjection } from './RecordsBatchUpdatedRealtimeProjection';
import { RecordsDeletedRealtimeProjection } from './RecordsDeletedRealtimeProjection';
import { RecordUpdatedRealtimeProjection } from './RecordUpdatedRealtimeProjection';
import { TableCreatedRealtimeProjection } from './TableCreatedRealtimeProjection';
import { buildRecordCollection } from './TableRecordRealtimeDTO';
import { ViewColumnMetaUpdatedRealtimeProjection } from './ViewColumnMetaUpdatedRealtimeProjection';

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
  }> = [];
  deletes: RealtimeDocId[] = [];

  async ensure(_context: IExecutionContext, docId: RealtimeDocId, initial: unknown) {
    this.ensures.push({ docId, initial });
    return ok(undefined);
  }

  async applyChange(
    _context: IExecutionContext,
    docId: RealtimeDocId,
    change: RealtimeChange | ReadonlyArray<RealtimeChange>
  ) {
    this.changes.push({ docId, change });
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, docId: RealtimeDocId) {
    this.deletes.push(docId);
    return ok(undefined);
  }
}

class FakeTableRepository implements ITableRepository {
  constructor(private readonly table: Table) {}

  async insert() {
    return ok(this.table);
  }

  async insertMany() {
    return ok([this.table]);
  }

  async findOne() {
    return ok(this.table);
  }

  async find() {
    return ok([this.table]);
  }

  async updateOne() {
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

  toDomain() {
    return err(domainError.unexpected({ message: 'not used' }));
  }
}

describe('Realtime projections', () => {
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
    expect(engine.changes[0]?.change).toEqual({
      type: 'set',
      path: ['fields', table.primaryFieldId().toString()],
      value: 'New',
    });
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
      },
    ]);
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

  it('projects field creation when snapshot is available', async () => {
    const table = buildTable('t', 'u', 'v');
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new FieldCreatedRealtimeProjection(engine, repository, mapper);

    const event = FieldCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId: table.primaryFieldId(),
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

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

    const event = FieldCreated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      fieldId: table.primaryFieldId(),
    });

    const result = await projection.handle(createContext(), event);

    expect(result._unsafeUnwrapErr().message).toContain('Missing field snapshot');
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

  it('updates view column meta when view exists', async () => {
    const table = buildTable('c', 'd', 'e');
    const viewId = table.views()[0]?.id() ?? ViewId.create(`viw${'a'.repeat(16)}`)._unsafeUnwrap();
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new ViewColumnMetaUpdatedRealtimeProjection(engine, repository, mapper);

    const event = ViewColumnMetaUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      viewId,
      fieldId: table.primaryFieldId(),
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

    expect(engine.ensures).toHaveLength(1);
    expect(engine.changes).toHaveLength(1);
  });

  it('ignores missing views', async () => {
    const table = buildTable('f', 'g', 'h');
    const engine = new FakeRealtimeEngine();
    const repository = new FakeTableRepository(table);
    const mapper = new FakeTableMapper(buildTableDto);
    const projection = new ViewColumnMetaUpdatedRealtimeProjection(engine, repository, mapper);

    const event = ViewColumnMetaUpdated.create({
      baseId: table.baseId(),
      tableId: table.id(),
      viewId: ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap(),
      fieldId: table.primaryFieldId(),
    });

    const result = await projection.handle(createContext(), event);
    result._unsafeUnwrap();

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
