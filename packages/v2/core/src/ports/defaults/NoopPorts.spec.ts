import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';

import { NoopEventBus } from './NoopEventBus';
import { NoopLogger } from './NoopLogger';
import { NoopTableRepository } from './NoopTableRepository';
import { NoopTableSchemaRepository } from './NoopTableSchemaRepository';
import { NoopTracer } from './NoopTracer';
import { NoopUnitOfWork } from './NoopUnitOfWork';

const buildTable = () => {
  const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
  const tableNameResult = TableName.create('Noop Table');
  const fieldNameResult = FieldName.create('Title');
  expect([baseIdResult, tableNameResult, fieldNameResult].every((r) => r.isOk())).toBe(true);
  if (baseIdResult.isErr() || tableNameResult.isErr() || fieldNameResult.isErr()) return undefined;
  const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
  builder.field().singleLineText().withName(fieldNameResult.value).done();
  builder.view().defaultGrid().done();
  const result = builder.build();
  expect(result.isOk()).toBe(true);
  if (result.isErr()) return undefined;
  return result.value;
};

describe('NoopEventBus', () => {
  it('publishes events with ok results', async () => {
    const bus = new NoopEventBus();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const context = { actorId: actorIdResult.value };
    const event = { name: { toString: () => 'Test' }, occurredAt: { toDate: () => new Date() } };
    expect((await bus.publish(context, event as never)).isOk()).toBe(true);
    expect((await bus.publishMany(context, [event as never])).isOk()).toBe(true);
  });
});

describe('NoopTableRepository', () => {
  it('accepts inserts and returns not found for queries', async () => {
    const table = buildTable();
    if (!table) return;
    const repo = new NoopTableRepository();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const context = { actorId: actorIdResult.value };
    expect((await repo.insert(context, table)).isOk()).toBe(true);
    const queryResult = await repo.findOne(context, { isSatisfiedBy: () => true } as never);
    expect(queryResult.isErr()).toBe(true);
  });
});

describe('NoopTableSchemaRepository', () => {
  it('accepts inserts', async () => {
    const table = buildTable();
    if (!table) return;
    const repo = new NoopTableSchemaRepository();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const context = { actorId: actorIdResult.value };
    expect((await repo.insert(context, table)).isOk()).toBe(true);
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
    if (actorIdResult.isErr()) return;
    const context = { actorId: actorIdResult.value };
    const result = await unit.withTransaction(context, async () => ok('ok'));
    expect(result.isOk()).toBe(true);
  });

  it('returns error when work throws', async () => {
    const unit = new NoopUnitOfWork();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const context = { actorId: actorIdResult.value };
    const result = await unit.withTransaction(context, async () => {
      throw new Error('boom');
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Unexpected unit of work error');
    }
  });

  it('reports non-Error throws', async () => {
    const unit = new NoopUnitOfWork();
    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const context = { actorId: actorIdResult.value };
    const result = await unit.withTransaction(context, async () => {
      throw 'boom';
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('boom');
    }
  });
});
