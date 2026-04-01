import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { FieldName } from '../../domain/table/fields/FieldName';
import { RecordId } from '../../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
} from '../../ports/TableRecordQueryRepository';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { composeRecordConditionSpecs, ensureRecordIdsWithinScope } from './recordWriteScope';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'t'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Scoped Writes')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  calls: Array<{ options?: { mode?: string; includeTotal?: boolean } }> = [];

  constructor(private readonly result: Result<ITableRecordQueryResult, DomainError>) {}

  async find(
    _context: IExecutionContext,
    _table: Table,
    _spec?: unknown,
    options?: { mode?: string; includeTotal?: boolean }
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    this.calls.push({ options });
    return this.result;
  }

  async findOne(): Promise<Result<TableRecordReadModel, DomainError>> {
    return err(domainError.notFound({ message: 'Not implemented' }));
  }

  async *findStream() {
    return;
  }
}

describe('recordWriteScope', () => {
  it('composeRecordConditionSpecs keeps only defined specs', () => {
    const a = RecordByIdsSpec.create([RecordId.create(`rec${'a'.repeat(14)}01`)._unsafeUnwrap()]);
    const b = RecordByIdsSpec.create([RecordId.create(`rec${'b'.repeat(14)}02`)._unsafeUnwrap()]);

    const composed = composeRecordConditionSpecs(undefined, a, undefined, b);

    expect(composed).toBeDefined();
  });

  it('returns ok when scope is empty or no record ids are requested', async () => {
    const table = buildTable();
    const queryRepository = new FakeTableRecordQueryRepository(ok({ records: [], total: 0 }));

    const withoutScope = await ensureRecordIdsWithinScope(
      createContext(),
      table,
      [RecordId.create(`rec${'c'.repeat(14)}01`)._unsafeUnwrap()],
      undefined,
      queryRepository,
      'updateMany'
    );
    const withoutIds = await ensureRecordIdsWithinScope(
      createContext(),
      table,
      [],
      RecordByIdsSpec.create([RecordId.create(`rec${'d'.repeat(14)}02`)._unsafeUnwrap()]),
      queryRepository,
      'updateMany'
    );

    expect(withoutScope.isOk()).toBe(true);
    expect(withoutIds.isOk()).toBe(true);
    expect(queryRepository.calls).toHaveLength(0);
  });

  it('returns forbidden when requested ids exceed authorized scope', async () => {
    const table = buildTable();
    const requestedIds = [
      RecordId.create(`rec${'e'.repeat(14)}01`)._unsafeUnwrap(),
      RecordId.create(`rec${'f'.repeat(14)}02`)._unsafeUnwrap(),
    ];
    const queryRepository = new FakeTableRecordQueryRepository(
      ok({
        records: [{ id: requestedIds[0]!.toString() }] as unknown as TableRecordReadModel[],
        total: 1,
      })
    );

    const result = await ensureRecordIdsWithinScope(
      createContext(),
      table,
      requestedIds,
      RecordByIdsSpec.create(requestedIds),
      queryRepository,
      'deleteMany'
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record_write_plugin.scope_forbidden');
    expect(result._unsafeUnwrapErr().details).toMatchObject({
      operation: 'deleteMany',
      tableId: table.id().toString(),
      requestedRecordCount: 2,
      authorizedRecordCount: 1,
    });
    expect(queryRepository.calls).toEqual([{ options: { mode: 'stored', includeTotal: false } }]);
  });

  it('propagates query repository errors', async () => {
    const table = buildTable();
    const requestedIds = [RecordId.create(`rec${'g'.repeat(14)}01`)._unsafeUnwrap()];
    const queryRepository = new FakeTableRecordQueryRepository(
      err(
        domainError.infrastructure({
          code: 'scope.query_failed',
          message: 'scope query failed',
        })
      )
    );

    const result = await ensureRecordIdsWithinScope(
      createContext(),
      table,
      requestedIds,
      RecordByIdsSpec.create(requestedIds),
      queryRepository,
      'clear'
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('scope.query_failed');
  });
});
