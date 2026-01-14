import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { FieldCreated } from '../../domain/table/events/FieldCreated';
import { FieldDeleted } from '../../domain/table/events/FieldDeleted';
import { RecordCreated } from '../../domain/table/events/RecordCreated';
import { RecordsBatchUpdated } from '../../domain/table/events/RecordsBatchUpdated';
import { RecordsDeleted } from '../../domain/table/events/RecordsDeleted';
import { RecordUpdated } from '../../domain/table/events/RecordUpdated';
import { TableCreated } from '../../domain/table/events/TableCreated';
import { ViewColumnMetaUpdated } from '../../domain/table/events/ViewColumnMetaUpdated';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { RecordId } from '../../domain/table/records/RecordId';
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
import { RecordCreatedRealtimeProjection } from './RecordCreatedRealtimeProjection';
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
  changes: Array<{ docId: RealtimeDocId; change: RealtimeChange }> = [];
  deletes: RealtimeDocId[] = [];

  async ensure(_context: IExecutionContext, docId: RealtimeDocId, initial: unknown) {
    this.ensures.push({ docId, initial });
    return ok(undefined);
  }

  async applyChange(_context: IExecutionContext, docId: RealtimeDocId, change: RealtimeChange) {
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

    expect(engine.ensures).toHaveLength(1);
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

    expect(engine.ensures).toHaveLength(1);
    expect(engine.changes).toHaveLength(1);
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
});
