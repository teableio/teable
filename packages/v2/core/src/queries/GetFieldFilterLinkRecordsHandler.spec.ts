import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
} from '../ports/TableRecordQueryRepository';
import { GetFieldFilterLinkRecordsHandler } from './GetFieldFilterLinkRecordsHandler';
import { GetFieldFilterLinkRecordsQuery } from './GetFieldFilterLinkRecordsQuery';
import type { ViewFilterLinkRecordGroup } from './GetViewFilterLinkRecordsHandler';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};
const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const recordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();

type FieldFilterLinkTables = {
  sourceTable: Table;
  foreignTable: Table;
  lookupTable: Table;
  sourceLinkFieldId: FieldId;
  firstRecordId: RecordId;
  secondRecordId: RecordId;
};

const buildTables = (options?: { withFilter?: boolean }): FieldFilterLinkTables => {
  const lookupBuilder = Table.builder()
    .withId(tableId('c'))
    .withBaseId(baseId)
    .withName(TableName.create('Lookup')._unsafeUnwrap());
  lookupBuilder
    .field()
    .singleLineText()
    .withId(fieldId('c'))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  lookupBuilder.view().defaultGrid().done();
  const lookupTable = lookupBuilder.build()._unsafeUnwrap();

  const foreignLinkFieldId = fieldId('e');
  const foreignBuilder = Table.builder()
    .withId(tableId('b'))
    .withBaseId(baseId)
    .withName(TableName.create('Foreign')._unsafeUnwrap());
  foreignBuilder
    .field()
    .singleLineText()
    .withId(fieldId('b'))
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  foreignBuilder
    .field()
    .link()
    .withId(foreignLinkFieldId)
    .withName(FieldName.create('Lookup')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: lookupTable.id().toString(),
        lookupFieldId: lookupTable.primaryFieldId().toString(),
        isOneWay: true,
      })._unsafeUnwrap()
    )
    .done();
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder.build()._unsafeUnwrap();

  const sourceLinkFieldId = fieldId('d');
  const firstRecordId = recordId('f');
  const secondRecordId = recordId('g');
  const sourceBuilder = Table.builder()
    .withId(tableId('a'))
    .withBaseId(baseId)
    .withName(TableName.create('Source')._unsafeUnwrap());
  sourceBuilder
    .field()
    .singleLineText()
    .withId(fieldId('a'))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  sourceBuilder
    .field()
    .link()
    .withId(sourceLinkFieldId)
    .withName(FieldName.create('Foreign')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignTable.primaryFieldId().toString(),
        isOneWay: true,
        filter:
          options?.withFilter === false
            ? undefined
            : {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignLinkFieldId.toString(),
                    operator: 'isAnyOf',
                    value: [firstRecordId.toString(), secondRecordId.toString()],
                  },
                ],
              },
      })._unsafeUnwrap()
    )
    .done();
  sourceBuilder.view().defaultGrid().done();
  const sourceTable = sourceBuilder.build()._unsafeUnwrap();

  return {
    sourceTable,
    foreignTable,
    lookupTable,
    sourceLinkFieldId,
    firstRecordId,
    secondRecordId,
  };
};

const createRecordRepository = (
  find: ITableRecordQueryRepository['find']
): ITableRecordQueryRepository =>
  ({
    find,
  }) as unknown as ITableRecordQueryRepository;

const execute = async (
  tables: FieldFilterLinkTables,
  recordRepository: ITableRecordQueryRepository,
  tableRepository = new MemoryTableRepository()
) => {
  await tableRepository.insert(context, tables.sourceTable);
  await tableRepository.insert(context, tables.foreignTable);
  await tableRepository.insert(context, tables.lookupTable);
  const handler = new GetFieldFilterLinkRecordsHandler(
    tableRepository,
    recordRepository,
    new NoopLogger()
  );
  const query = GetFieldFilterLinkRecordsQuery.create({
    tableId: tables.sourceTable.id().toString(),
    fieldId: tables.sourceLinkFieldId.toString(),
  })._unsafeUnwrap();
  return handler.handle(context, query);
};

describe('GetFieldFilterLinkRecordsQuery', () => {
  it('creates nominal Table and Field IDs', () => {
    const tables = buildTables();
    const query = GetFieldFilterLinkRecordsQuery.create({
      tableId: tables.sourceTable.id().toString(),
      fieldId: tables.sourceLinkFieldId.toString(),
    })._unsafeUnwrap();

    expect(query.tableId.equals(tables.sourceTable.id())).toBe(true);
    expect(query.fieldId.equals(tables.sourceLinkFieldId)).toBe(true);
  });

  it('rejects malformed identifiers', () => {
    expect(
      GetFieldFilterLinkRecordsQuery.create({
        tableId: 'invalid',
        fieldId: 'invalid',
      })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });
});

describe('GetFieldFilterLinkRecordsHandler', () => {
  it('loads the foreign Table and queries linked records referenced by the Field filter', async () => {
    const tables = buildTables();
    let capturedOptions: ITableRecordQueryOptions | undefined;
    const find = vi.fn<ITableRecordQueryRepository['find']>(
      async (_context, table, spec, options) => {
        expect(table.id().equals(tables.lookupTable.id())).toBe(true);
        expect(spec).toBeInstanceOf(RecordByIdsSpec);
        expect((spec as RecordByIdsSpec).recordIds().map((id) => id.toString())).toEqual([
          tables.firstRecordId.toString(),
          tables.secondRecordId.toString(),
        ]);
        capturedOptions = options;
        return ok({
          records: [
            {
              id: tables.firstRecordId.toString(),
              fields: { [tables.lookupTable.primaryFieldId().toString()]: 'Alpha' },
              version: 1,
            },
            {
              id: tables.secondRecordId.toString(),
              fields: { [tables.lookupTable.primaryFieldId().toString()]: null },
              version: 1,
            },
          ],
          total: 2,
        });
      }
    );

    const result = await execute(tables, createRecordRepository(find));

    expect(result._unsafeUnwrap().groups).toEqual<ViewFilterLinkRecordGroup[]>([
      {
        tableId: tables.lookupTable.id().toString(),
        records: [
          { id: tables.firstRecordId.toString(), title: 'Alpha' },
          { id: tables.secondRecordId.toString() },
        ],
      },
    ]);
    expect(capturedOptions).toMatchObject({
      mode: 'stored',
      orderBy: [{ column: '__auto_number', direction: 'asc' }],
      includeTotal: false,
    });
  });

  it('returns an empty result without querying records when the Field has no filter', async () => {
    const tables = buildTables({ withFilter: false });
    const find = vi.fn<ITableRecordQueryRepository['find']>();

    const result = await execute(tables, createRecordRepository(find));

    expect(result._unsafeUnwrap().groups).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('maps a missing Table to table.not_found', async () => {
    const tables = buildTables();
    const handler = new GetFieldFilterLinkRecordsHandler(
      new MemoryTableRepository(),
      createRecordRepository(vi.fn<ITableRecordQueryRepository['find']>()),
      new NoopLogger()
    );
    const query = GetFieldFilterLinkRecordsQuery.create({
      tableId: tables.sourceTable.id().toString(),
      fieldId: tables.sourceLinkFieldId.toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'table.not_found',
    });
  });

  it('propagates linked-record repository failures', async () => {
    const tables = buildTables();
    const repository = createRecordRepository(async () =>
      err(domainError.unexpected({ message: 'record query failed' }))
    );

    const result = await execute(tables, repository);

    expect(result._unsafeUnwrapErr().message).toBe('record query failed');
  });
});
