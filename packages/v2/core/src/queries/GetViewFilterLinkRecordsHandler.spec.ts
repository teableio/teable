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
import { GridView } from '../domain/table/views/types/GridView';
import { ViewId } from '../domain/table/views/ViewId';
import { ViewName } from '../domain/table/views/ViewName';
import { ViewQueryDefaults } from '../domain/table/views/ViewQueryDefaults';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
} from '../ports/TableRecordQueryRepository';
import {
  GetViewFilterLinkRecordsHandler,
  type ViewFilterLinkRecordGroup,
} from './GetViewFilterLinkRecordsHandler';
import { GetViewFilterLinkRecordsQuery } from './GetViewFilterLinkRecordsQuery';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};
const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const recordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();
const viewId = (seed: string) => ViewId.create(`viw${seed.repeat(16)}`)._unsafeUnwrap();

const buildTables = (options?: { missingLookupField?: boolean; withFilter?: boolean }) => {
  const foreignBuilder = Table.builder()
    .withId(tableId('b'))
    .withBaseId(baseId)
    .withName(TableName.create('Foreign')._unsafeUnwrap());
  foreignBuilder
    .field()
    .singleLineText()
    .withId(fieldId('c'))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder.build()._unsafeUnwrap();
  const lookupFieldId = options?.missingLookupField ? fieldId('z') : foreignTable.primaryFieldId();
  const linkFieldId = fieldId('d');
  const ownedViewId = viewId('e');
  const firstRecordId = recordId('f');
  const secondRecordId = recordId('g');

  const sourceBuilder = Table.builder()
    .withId(tableId('h'))
    .withBaseId(baseId)
    .withName(TableName.create('Source')._unsafeUnwrap());
  sourceBuilder
    .field()
    .singleLineText()
    .withId(fieldId('i'))
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  sourceBuilder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Foreign')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: lookupFieldId.toString(),
        isOneWay: true,
      })._unsafeUnwrap()
    )
    .done();
  sourceBuilder.view().defaultGrid().done();
  const sourceFieldsTable = sourceBuilder.build()._unsafeUnwrap();
  const sourceView = GridView.create({
    id: ownedViewId,
    name: ViewName.create('Grid')._unsafeUnwrap(),
  })._unsafeUnwrap();
  sourceView
    .setQueryDefaults(
      ViewQueryDefaults.rehydrate(
        {},
        {
          sourceFilter:
            options?.withFilter === false
              ? null
              : {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: linkFieldId.toString(),
                      operator: 'isAnyOf',
                      value: [firstRecordId.toString(), secondRecordId.toString()],
                    },
                  ],
                },
        }
      )._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  const sourceTable = Table.rehydrate({
    id: sourceFieldsTable.id(),
    baseId: sourceFieldsTable.baseId(),
    name: sourceFieldsTable.name(),
    fields: sourceFieldsTable.getFields(),
    views: [sourceView],
    primaryFieldId: sourceFieldsTable.primaryFieldId(),
  })._unsafeUnwrap();

  return {
    sourceTable,
    foreignTable,
    lookupFieldId,
    ownedViewId,
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
  tables: ReturnType<typeof buildTables>,
  recordRepository: ITableRecordQueryRepository,
  tableRepository = new MemoryTableRepository()
) => {
  await tableRepository.insert(context, tables.sourceTable);
  await tableRepository.insert(context, tables.foreignTable);
  const handler = new GetViewFilterLinkRecordsHandler(
    tableRepository,
    recordRepository,
    new NoopLogger()
  );
  const query = GetViewFilterLinkRecordsQuery.create({
    tableId: tables.sourceTable.id().toString(),
    viewId: tables.ownedViewId.toString(),
  })._unsafeUnwrap();
  return handler.handle(context, query);
};

describe('GetViewFilterLinkRecordsQuery', () => {
  it('creates nominal Table and View IDs', () => {
    const tables = buildTables();
    const query = GetViewFilterLinkRecordsQuery.create({
      tableId: tables.sourceTable.id().toString(),
      viewId: tables.ownedViewId.toString(),
    })._unsafeUnwrap();

    expect(query.tableId.equals(tables.sourceTable.id())).toBe(true);
    expect(query.viewId.equals(tables.ownedViewId)).toBe(true);
  });

  it('rejects malformed identifiers', () => {
    const result = GetViewFilterLinkRecordsQuery.create({
      tableId: 'invalid',
      viewId: 'invalid',
    });

    expect(result._unsafeUnwrapErr().code).toBe('validation.invalid');
  });
});

describe('GetViewFilterLinkRecordsHandler', () => {
  it('loads Table aggregates and queries linked records in auto-number order', async () => {
    const tables = buildTables();
    let capturedOptions: ITableRecordQueryOptions | undefined;
    const find = vi.fn<ITableRecordQueryRepository['find']>(
      async (_context, table, spec, options) => {
        expect(table.id().equals(tables.foreignTable.id())).toBe(true);
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
              fields: { [tables.lookupFieldId.toString()]: 'Alpha' },
              version: 1,
            },
            {
              id: tables.secondRecordId.toString(),
              fields: { [tables.lookupFieldId.toString()]: null },
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
        tableId: tables.foreignTable.id().toString(),
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
    expect(capturedOptions?.projectionFieldIds?.[0]?.equals(tables.lookupFieldId)).toBe(true);
  });

  it('returns an empty result without querying records when the View has no filter references', async () => {
    const tables = buildTables({ withFilter: false });
    const find = vi.fn<ITableRecordQueryRepository['find']>();

    const result = await execute(tables, createRecordRepository(find));

    expect(result._unsafeUnwrap().groups).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('skips a foreign group whose Link lookup Field no longer exists', async () => {
    const tables = buildTables({ missingLookupField: true });
    const find = vi.fn<ITableRecordQueryRepository['find']>();

    const result = await execute(tables, createRecordRepository(find));

    expect(result._unsafeUnwrap().groups).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('maps an unknown Table/View association to view.not_found', async () => {
    const tables = buildTables();
    const handler = new GetViewFilterLinkRecordsHandler(
      new MemoryTableRepository(),
      createRecordRepository(vi.fn<ITableRecordQueryRepository['find']>()),
      new NoopLogger()
    );
    const query = GetViewFilterLinkRecordsQuery.create({
      tableId: tables.sourceTable.id().toString(),
      viewId: tables.ownedViewId.toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'view.not_found',
      message: `View not found: ${tables.ownedViewId.toString()}`,
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
