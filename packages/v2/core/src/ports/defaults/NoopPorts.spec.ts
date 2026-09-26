import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldName } from '../../domain/table/fields/FieldName';
import { RecordId } from '../../domain/table/records/RecordId';
import type { ICellValueSpec } from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import { TableRecord } from '../../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../../domain/table/records/TableRecordFields';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import { createUndoRedoCommand } from '../UndoRedoStore';

import { RealtimeDocId } from '../RealtimeDocId';

import { NoopEventBus } from './NoopEventBus';
import { NoopLogger } from './NoopLogger';
import { NoopRealtimeEngine } from './NoopRealtimeEngine';
import { NoopTableRecordQueryRepository } from './NoopTableRecordQueryRepository';
import { NoopTableRecordRepository } from './NoopTableRecordRepository';
import { NoopTableRepository } from './NoopTableRepository';
import { NoopTableSchemaRepository } from './NoopTableSchemaRepository';
import { NoopTracer } from './NoopTracer';
import { NoopUndoRedoStore } from './NoopUndoRedoStore';
import { NoopUnitOfWork } from './NoopUnitOfWork';

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Noop Table')._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();
  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildRecord = (table: Table): TableRecord => {
  const recordId = RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap();
  const field = table.getFields()[0];
  const cellValue = TableRecordCellValue.create('demo')._unsafeUnwrap();
  const recordResult = TableRecord.create({
    id: recordId,
    tableId: table.id(),
    fieldValues: [{ fieldId: field.id(), value: cellValue }],
  });
  return recordResult._unsafeUnwrap();
};

describe('NoopEventBus', () => {
  it('publishes events with ok results', async () => {
    const bus = new NoopEventBus();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const event = { name: { toString: () => 'Test' }, occurredAt: { toDate: () => new Date() } };
    expect((await bus.publish(context, event as never)).isOk()).toBe(true);
    expect((await bus.publishMany(context, [event as never])).isOk()).toBe(true);
  });
});

describe('NoopTableRepository', () => {
  it('accepts inserts and returns not found for queries', async () => {
    const table = buildTable();
    const repo = new NoopTableRepository();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    expect((await repo.insert(context, table)).isOk()).toBe(true);
    const queryResult = await repo.findOne(context, { isSatisfiedBy: () => true } as never);
    expect(queryResult.isErr()).toBe(true);
    expect((await repo.delete(context, table)).isOk()).toBe(true);
  });
});

describe('NoopTableRecordQueryRepository', () => {
  it('returns empty results for reads', async () => {
    const table = buildTable();
    const repo = new NoopTableRecordQueryRepository();
    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    (await repo.find(context, table))._unsafeUnwrap();
    expect((await repo.count(context, table))._unsafeUnwrap()).toBe(0);
  });
});

describe('NoopTableRecordRepository', () => {
  it('accepts record writes', async () => {
    const table = buildTable();
    const record = buildRecord(table);
    const repo = new NoopTableRecordRepository();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const deleteSpec = TableRecord.specs().recordId(record.id()).build()._unsafeUnwrap();
    const mutateSpec: ICellValueSpec = {
      isSatisfiedBy: () => true,
      mutate: () => ok(record),
      accept: () => ok(undefined),
    };
    expect((await repo.insert(context, table, record)).isOk()).toBe(true);
    expect((await repo.updateOne(context, table, record.id(), mutateSpec)).isOk()).toBe(true);
    expect((await repo.deleteMany(context, table, deleteSpec)).isOk()).toBe(true);
  });
});

describe('NoopTableSchemaRepository', () => {
  it('accepts inserts and deletes', async () => {
    const table = buildTable();
    const repo = new NoopTableSchemaRepository();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const mutateSpec: ISpecification<Table, ITableSpecVisitor> = {
      isSatisfiedBy: () => true,
      mutate: () => ok(table),
      accept: () => ok(undefined),
    };
    expect((await repo.insert(context, table)).isOk()).toBe(true);
    expect((await repo.update(context, table, mutateSpec)).isOk()).toBe(true);
    expect((await repo.delete(context, table)).isOk()).toBe(true);
  });
});

describe('NoopUndoRedoStore', () => {
  it('accepts append/undo/redo/list', async () => {
    const store = new NoopUndoRedoStore();
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
    const scope = { actorId, tableId, windowId: 'window-1' };

    expect(
      (
        await store.append(scope, {
          scope,
          undoCommand: createUndoRedoCommand('UpdateRecord', {
            tableId: tableId.toString(),
            recordId: `rec${'b'.repeat(16)}`,
            fields: { fld: 'old' },
            fieldKeyType: 'id',
            typecast: false,
          }),
          redoCommand: createUndoRedoCommand('UpdateRecord', {
            tableId: tableId.toString(),
            recordId: `rec${'b'.repeat(16)}`,
            fields: { fld: 'new' },
            fieldKeyType: 'id',
            typecast: false,
          }),
          recordVersionBefore: 1,
          recordVersionAfter: 2,
          createdAt: new Date().toISOString(),
        })
      ).isOk()
    ).toBe(true);
    expect((await store.undo(scope)).isOk()).toBe(true);
    expect((await store.redo(scope)).isOk()).toBe(true);
    expect((await store.list(scope)).isOk()).toBe(true);
  });
});

describe('NoopLogger', () => {
  it('does not throw when logging', () => {
    const logger = new NoopLogger();
    expect(() => logger.debug('debug')).not.toThrow();
    expect(() => logger.info('info')).not.toThrow();
    expect(() => logger.warn('warn')).not.toThrow();
    expect(() => logger.error('error')).not.toThrow();
  });

  it('creates contextual loggers without throwing', () => {
    const logger = new NoopLogger();
    expect(() => logger.child({ requestId: 'req-1' }).debug('debug')).not.toThrow();
    expect(() => logger.scope('handler', { name: 'TestHandler' }).info('info')).not.toThrow();
  });
});

describe('NoopRealtimeEngine', () => {
  it('accepts changes without errors', async () => {
    const engine = new NoopRealtimeEngine();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const docIdResult = RealtimeDocId.create('doc-1');
    const docId = docIdResult._unsafeUnwrap();

    expect((await engine.ensure(context, docId, { title: 'init' })).isOk()).toBe(true);
    expect(
      (
        await engine.applyChange(context, docId, {
          type: 'set',
          path: ['title'],
          value: 'next',
        })
      ).isOk()
    ).toBe(true);
  });
});

describe('NoopTracer', () => {
  it('creates spans that are safe to use', () => {
    const tracer = new NoopTracer();
    const span = tracer.startSpan('test', { key: 'value' });
    expect(() => span.setAttribute('key', 'value')).not.toThrow();
    expect(() => span.setAttributes({ other: 'value' })).not.toThrow();
    expect(() => span.recordError('err')).not.toThrow();
    expect(() => span.end()).not.toThrow();
  });
});

describe('NoopUnitOfWork', () => {
  it('wraps work without failing', async () => {
    const unit = new NoopUnitOfWork();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await unit.withTransaction(context, async () => ok('ok'));
    expect(result.isOk()).toBe(true);
  });

  it('returns error when work throws', async () => {
    const unit = new NoopUnitOfWork();
    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await unit.withTransaction(context, async () => {
      throw new Error('boom');
    });
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toContain('Unexpected unit of work error');
  });

  it('reports non-Error throws', async () => {
    const unit = new NoopUnitOfWork();
    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await unit.withTransaction(context, async () => {
      throw 'boom';
    });
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toContain('boom');
  });
});
