import { ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { PasteCommand } from '../../commands/PasteCommand';
import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import { SelectOption } from '../../domain/table/fields/types/SelectOption';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryStreamOptions,
} from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { PastePreparationService } from './PastePreparationService';
import type { RecordWritePluginExecution } from './RecordWritePluginRunner';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'p'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'p'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Paste preparation')._unsafeUnwrap());
  const titleFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const statusFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  builder
    .field()
    .singleLineText()
    .withId(titleFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleSelect()
    .withId(statusFieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([SelectOption.create({ name: 'Open', color: 'blue' })._unsafeUnwrap()])
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  return {
    table,
    tableId,
    titleFieldId: titleFieldId.toString(),
    statusFieldId: statusFieldId.toString(),
    viewId: table.views()[0]!.id(),
  };
};

class CapturingRecordQueryRepository {
  readonly calls: ITableRecordQueryStreamOptions[] = [];

  constructor(
    readonly records: ReadonlyArray<TableRecordReadModel>,
    private readonly total = records.length
  ) {}

  async find(): Promise<
    Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>
  > {
    return ok({ records: this.records, total: this.total });
  }

  findStream(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    if (options) this.calls.push(options);
    const offset =
      options?.pagination && 'offset' in options.pagination ? options.pagination.offset : 0;
    const limit = options?.pagination?.limit ?? this.records.length;
    const records = this.records.slice(offset, offset + limit);
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const record of records) yield ok(record);
      },
    };
  }
}

const createService = (table: Table, queryRepository: CapturingRecordQueryRepository) =>
  new PastePreparationService(
    { getById: async () => ok(table) } as never,
    queryRepository as unknown as ITableRecordQueryRepository,
    { load: async () => ok([]) } as never
  );

describe('PastePreparationService', () => {
  it('uses the requested range and search to split selected updates from overflow creates', async () => {
    const { table, tableId, titleFieldId, statusFieldId, viewId } = buildTable();
    const records: TableRecordReadModel[] = [
      { id: `rec${'a'.repeat(16)}`, version: 1, fields: { [titleFieldId]: 'A' } },
      { id: `rec${'b'.repeat(16)}`, version: 1, fields: { [titleFieldId]: 'B' } },
    ];
    const repository = new CapturingRecordQueryRepository(records);
    const command = PasteCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 1],
        [1, 2],
      ],
      content: [
        ['updated', 'Review'],
        ['created', 'Done'],
      ],
      search: ['needle', '', true],
      typecast: true,
    })._unsafeUnwrap();

    const result = await createService(table, repository).prepare(context, command, {
      readAuthorization: 'unknown',
    });

    expect(result.isOk()).toBe(true);
    const preparation = result._unsafeUnwrap();
    expect(preparation.updateOperations.map((operation) => operation.existingRecord.id)).toEqual([
      records[1]!.id,
    ]);
    expect(preparation.createOperations).toHaveLength(1);
    expect(preparation.facts).toMatchObject({
      submittedRows: 2,
      selectedRows: 1,
      acceptedRows: 2,
      updateCandidates: 1,
      createCandidates: 1,
      affectedRowsEstablished: false,
      readAuthorization: 'unknown',
      writeAuthorization: 'unknown',
    });
    expect(preparation.facts.selectOptionCreations).toEqual([
      expect.objectContaining({ optionCount: 2 }),
    ]);
    expect(repository.calls[0]?.pagination).toEqual({ offset: 1, limit: 2 });
    expect(repository.calls[0]?.search?.search.value).toBe('needle');
    expect(preparation.editableColumns.map((column) => column.fieldId.toString())).toEqual([
      titleFieldId,
      statusFieldId,
    ]);
  });

  it('applies the execution write scope to update and create candidates', async () => {
    const { table, tableId, titleFieldId, viewId } = buildTable();
    const repository = new CapturingRecordQueryRepository([
      { id: `rec${'d'.repeat(16)}`, version: 1, fields: { [titleFieldId]: 'Old' } },
    ]);
    const command = PasteCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 1],
      ],
      content: [['update'], ['create']],
    })._unsafeUnwrap();
    const service = createService(table, repository);
    const preparation = (
      await service.prepare(context, command, { readAuthorization: 'checked' })
    )._unsafeUnwrap();
    const execution = {
      getScope: () =>
        ok({
          recordSpec: { isSatisfiedBy: () => false },
          createFieldIds: new Set<string>(),
        }),
      getUpdateFieldIdsForRecord: () => ok(new Set([titleFieldId])),
    } as unknown as RecordWritePluginExecution;

    const scoped = service.applyWriteScope(preparation, execution)._unsafeUnwrap();

    expect(scoped.updateOperations).toEqual([]);
    expect(scoped.createOperations).toEqual([]);
    expect(scoped.createColumns).toEqual([]);
    expect(scoped.rejectedUpdateRows).toBe(1);
  });

  it('reports selected rows excluded by the write filter instead of turning them into creates', async () => {
    const { table, tableId, titleFieldId, viewId } = buildTable();
    const repository = new CapturingRecordQueryRepository([
      {
        id: `rec${'c'.repeat(16)}`,
        version: 1,
        fields: { [titleFieldId]: 'Old title' },
      },
    ]);
    const command = PasteCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
      content: [['New title']],
      updateFilter: {
        fieldId: titleFieldId,
        operator: 'is',
        value: 'Different title',
      },
    })._unsafeUnwrap();

    const preparation = (
      await createService(table, repository).prepare(context, command, {
        readAuthorization: 'checked',
      })
    )._unsafeUnwrap();

    expect(preparation.updateOperations).toEqual([]);
    expect(preparation.createOperations).toEqual([]);
    expect(preparation.facts).toMatchObject({
      selectedRows: 1,
      acceptedRows: 0,
      rejectedSelectedRows: 1,
      updateCandidates: 0,
      createCandidates: 0,
    });
  });

  it('rejects a gigantic normalized range before allocating expanded content', async () => {
    const { table, tableId, viewId } = buildTable();
    const repository = new CapturingRecordQueryRepository([], 100_000_001);
    const command = PasteCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      type: 'columns',
      ranges: [[0, 0]],
      content: [['x']],
    })._unsafeUnwrap();

    const result = await createService(table, repository).prepare(context, command, {
      readAuthorization: 'unknown',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.paste.max_cells_exceeded',
    });
    expect(repository.calls).toEqual([]);
  });

  it('projects column expansion on a detached aggregate without persistence collaborators', async () => {
    const { table, tableId, viewId } = buildTable();
    const command = PasteCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [2, 0],
      ],
      content: [['title', 'status', 'extra']],
      sourceFields: [
        { type: 'singleLineText' },
        { type: 'singleSelect' },
        { type: 'number', cellValueType: 'number' },
      ],
    })._unsafeUnwrap();

    const preparation = (
      await createService(table, new CapturingRecordQueryRepository([])).prepare(context, command, {
        readAuthorization: 'unknown',
      })
    )._unsafeUnwrap();

    expect(table.getFields()).toHaveLength(2);
    expect(preparation.tableForPaste.getFields()).toHaveLength(3);
    expect(preparation.columnExpansion?.newFields).toHaveLength(1);
    expect(preparation.facts.columnExpansionCount).toBe(1);
  });

  it('does not mutate fields on the repository-loaded table while projecting columns', async () => {
    const { table, tableId, titleFieldId, viewId } = buildTable();
    const sourceTitle = table
      .getField((field) => field.id().toString() === titleFieldId)
      ._unsafeUnwrap();
    const command = PasteCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [2, 0],
      ],
      content: [['title', 'status', 'computed']],
      sourceFields: [
        { type: 'singleLineText' },
        { type: 'singleSelect' },
        {
          type: 'formula',
          options: {
            expression: FormulaExpression.create(`{${titleFieldId}}`)._unsafeUnwrap().toString(),
          },
        },
      ],
    })._unsafeUnwrap();

    const preparation = (
      await createService(table, new CapturingRecordQueryRepository([])).prepare(context, command, {
        readAuthorization: 'unknown',
      })
    )._unsafeUnwrap();

    expect(sourceTitle.dependents()).toEqual([]);
    expect(table.getFields()[0]).toBe(sourceTitle);
    expect(preparation.tableForPaste.getFields()[0]).not.toBe(sourceTitle);
    expect(preparation.tableForPaste.getFields()[0]?.dependents()).toHaveLength(1);
  });

  it('prepares typecast schema projections without write, event, undo, or hook dependencies', async () => {
    const { table, tableId, statusFieldId, viewId } = buildTable();
    const repository = new CapturingRecordQueryRepository([]);
    const command = PasteCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [1, 0],
        [1, 0],
      ],
      content: [['In Progress']],
      typecast: true,
    })._unsafeUnwrap();

    const preparation = (
      await createService(table, repository).prepare(context, command, {
        readAuthorization: 'unknown',
      })
    )._unsafeUnwrap();

    expect(preparation.facts.selectOptionCreations).toEqual([
      expect.objectContaining({ fieldId: expect.anything(), optionCount: 1 }),
    ]);
    expect(preparation.facts.selectOptionCreations[0]!.fieldId.toString()).toBe(statusFieldId);
    expect(preparation.facts.createCandidates).toBe(1);
    expect(preparation.facts.affectedRowsEstablished).toBe(false);
  });
});
