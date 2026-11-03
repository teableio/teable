import { ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldId } from '../../domain/table/fields/FieldId';
import type { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import { RecordId } from '../../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import { TableRecord } from '../../domain/table/records/TableRecord';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
  ITableRecordQueryStreamOptions,
} from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { BulkRecordPreparationService } from './BulkRecordPreparationService';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';

const recordId = (value: string) => RecordId.create(`rec${value.repeat(16)}`)._unsafeUnwrap();

const buildTable = () => {
  const tableId = TableId.create(`tbl${'t'.repeat(16)}`)._unsafeUnwrap();
  const titleId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
  const statusId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Preparation')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(titleId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleSelect()
    .withId(statusId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([])
    .done();
  builder.view().defaultGrid().done();
  return { table: builder.build()._unsafeUnwrap(), titleId, statusId };
};

class ReadOnlyRecordRepository implements ITableRecordQueryRepository {
  constructor(readonly rows: ReadonlyArray<TableRecordReadModel>) {}

  async find(
    _context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    const matching: TableRecordReadModel[] = [];
    for (const row of this.rows) {
      const entity = TableRecord.fromRawFieldValues({
        id: row.id,
        tableId: table.id(),
        fields: row.fields,
      })._unsafeUnwrap();
      if (!spec || spec.isSatisfiedBy(entity)) matching.push(row);
    }
    const limit = options?.pagination?.limit().toNumber();
    return ok({
      records: limit == null ? matching : matching.slice(0, limit),
      total: matching.length,
    });
  }

  async findOne(): Promise<Result<TableRecordReadModel, DomainError>> {
    return ok(this.rows[0]!);
  }

  async *findStream(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _options?: ITableRecordQueryStreamOptions
  ) {
    for (const row of this.rows) yield ok(row);
  }
}

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
  config: { allowSelectOptionAutoCreate: true },
};

const input = (
  records: ReadonlyArray<{ recordId: RecordId; fieldValues: ReadonlyMap<string, unknown> }>
) => ({
  records,
  fieldValues: new Map<string, unknown>(),
  fieldKeyType: 'id' as FieldKeyType,
  typecast: true,
  hasOrder: false,
  recordIds: undefined,
  filter: undefined,
});

describe('BulkRecordPreparationService', () => {
  it('distinguishes requested, loaded, missing, authorized, and plugin-filtered explicit rows', async () => {
    const { table, titleId, statusId } = buildTable();
    const first = recordId('a');
    const second = recordId('b');
    const missing = recordId('c');
    const repository = new ReadOnlyRecordRepository([
      { id: first.toString(), fields: { [titleId.toString()]: 'A' }, version: 1 },
      { id: second.toString(), fields: { [titleId.toString()]: 'B' }, version: 1 },
    ]);
    const service = new BulkRecordPreparationService(
      repository,
      new RecordWriteSideEffectService()
    );
    const result = await service.update(
      context,
      table,
      input([
        { recordId: first, fieldValues: new Map([[statusId.toString(), 'New']]) },
        { recordId: second, fieldValues: new Map([[statusId.toString(), 'New']]) },
        { recordId: missing, fieldValues: new Map([[statusId.toString(), 'New']]) },
      ]),
      { recordSpec: RecordByIdsSpec.create([first]) }
    );

    expect(result._unsafeUnwrap()).toMatchObject({
      requestedCount: 3,
      loadedCount: 2,
      selectedCount: 2,
      authorizedCount: 1,
      acceptedCount: 1,
      missingCount: 1,
      pluginFilteredCount: 1,
      affectedCount: null,
      policyChecked: true,
    });
    expect(result._unsafeUnwrap().schemaEffects).toHaveLength(1);
  });

  it('keeps authorization unknown without a read-only policy and never projects schema writes', async () => {
    const { table, statusId } = buildTable();
    const id = recordId('a');
    const values = new Map<string, unknown>([[statusId.toString(), 'New']]);
    const repository = new ReadOnlyRecordRepository([
      { id: id.toString(), fields: {}, version: 1 },
    ]);
    const service = new BulkRecordPreparationService(
      repository,
      new RecordWriteSideEffectService()
    );
    const result = await service.update(
      context,
      table,
      input([{ recordId: id, fieldValues: values }]),
      undefined
    );

    expect(result._unsafeUnwrap()).toMatchObject({
      selectedCount: 1,
      authorizedCount: null,
      acceptedCount: null,
      pluginFilteredCount: null,
      affectedCount: null,
      schemaEffects: [],
      policyChecked: false,
    });
    expect(values.get(statusId.toString())).toBe('New');
  });

  it('projects typecast schema effects from detached field-value maps', async () => {
    const { table, statusId } = buildTable();
    const id = recordId('a');
    const values = new Map<string, unknown>([[statusId.toString(), 'New']]);
    const repository = new ReadOnlyRecordRepository([
      { id: id.toString(), fields: {}, version: 1 },
    ]);
    const service = new BulkRecordPreparationService(
      repository,
      new RecordWriteSideEffectService()
    );

    const result = await service.update(
      context,
      table,
      input([{ recordId: id, fieldValues: values }]),
      {}
    );

    expect(result._unsafeUnwrap().schemaEffects).toHaveLength(1);
    expect(values).toEqual(new Map([[statusId.toString(), 'New']]));
    const status = table.getField((field) => field.id().equals(statusId))._unsafeUnwrap();
    expect((status as SingleSelectField).selectOptions()).toHaveLength(0);
  });

  it('counts selector ids and missing rows without treating unknown affected rows as zero', async () => {
    const { table, titleId } = buildTable();
    const first = recordId('a');
    const missing = recordId('c');
    const repository = new ReadOnlyRecordRepository([
      { id: first.toString(), fields: { [titleId.toString()]: 'A' }, version: 1 },
    ]);
    const service = new BulkRecordPreparationService(
      repository,
      new RecordWriteSideEffectService()
    );
    const result = await service.update(
      context,
      table,
      {
        recordIds: [first, missing],
        fieldValues: new Map([[titleId.toString(), 'Updated']]),
        fieldKeyType: 'id',
        typecast: false,
        hasOrder: false,
      },
      {}
    );

    expect(result._unsafeUnwrap()).toMatchObject({
      requestedCount: 2,
      selectedCount: 1,
      authorizedCount: 1,
      acceptedCount: 1,
      missingCount: 1,
      affectedCount: null,
    });
  });
});
