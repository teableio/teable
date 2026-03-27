import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { LinkTitleResolverService } from './LinkTitleResolverService';
import { PasteLinkAutoResolveService } from './PasteLinkAutoResolveService';
import type { RecordBatchCreationService } from './RecordBatchCreationService';
import { TableQueryService } from './TableQueryService';
import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { FieldNotNull } from '../../domain/table/fields/types/FieldNotNull';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import { LinkFieldConfig } from '../../domain/table/fields/types/LinkFieldConfig';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { ITableRepository } from '../../ports/TableRepository';
import type { TableFindOptions, TableUpdatePersistResult } from '../../ports/TableRepository';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const buildTextTable = (baseSeed: string, name: string) => {
  const baseId = BaseId.create(`bse${baseSeed.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(baseId)
    .withName(TableName.create(name)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder.field().singleLineText().withName(FieldName.create('Alt')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildFormulaPrimaryTable = (baseSeed: string, name: string) => {
  const baseId = BaseId.create(`bse${baseSeed.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(baseId)
    .withName(TableName.create(name)._unsafeUnwrap());
  builder
    .field()
    .formula()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .withExpression(FormulaExpression.create('1 + 1')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildTableWithBlockingRequiredField = (baseSeed: string, name: string) => {
  const baseId = BaseId.create(`bse${baseSeed.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(baseId)
    .withName(TableName.create(name)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Required')._unsafeUnwrap())
    .withNotNull(FieldNotNull.required())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildHostTable = (baseId: BaseId, foreignTable: Table, lookupFieldId?: string) => {
  const builder = Table.builder()
    .withBaseId(baseId)
    .withName(TableName.create('Host')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withName(FieldName.create('Link')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: lookupFieldId ?? foreignTable.primaryFieldId().toString(),
        isOneWay: true,
      })._unsafeUnwrap()
    )
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakeTableRepository implements ITableRepository {
  constructor(private readonly tables: ReadonlyArray<Table>) {}

  async insert() {
    return ok(this.tables[0]!);
  }

  async insertMany() {
    return ok(this.tables);
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: Pick<TableFindOptions, 'state'>
  ) {
    const table = this.tables.find((candidate) => spec.isSatisfiedBy(candidate));
    return table ? ok(table) : err(domainError.notFound({ message: 'table not found' }));
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: TableFindOptions
  ) {
    return ok(this.tables.filter((candidate) => spec.isSatisfiedBy(candidate)));
  }

  async updateOne(): Promise<Result<TableUpdatePersistResult | void, DomainError>> {
    return ok(undefined);
  }

  async restore(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeRecordQueryRepository implements ITableRecordQueryRepository {
  constructor(private readonly records: ReadonlyArray<TableRecordReadModel>) {}

  async find() {
    return ok({ records: this.records, total: this.records.length });
  }

  async findOne() {
    return err(domainError.notFound({ message: 'not found' }));
  }

  async *findStream() {
    for (const record of this.records) {
      yield ok(record);
    }
  }
}

describe('PasteLinkAutoResolveService', () => {
  it('reuses existing titles and batch-creates missing titles once', async () => {
    const foreignTable = buildTextTable('a', 'Foreign');
    const hostTable = buildHostTable(foreignTable.baseId(), foreignTable);
    const existingRecordId = `rec${'a'.repeat(16)}`;
    const creationCalls: Array<ReadonlyArray<string>> = [];
    const fakeBatchCreateService = {
      create: async (
        _context: IExecutionContext,
        input: Parameters<RecordBatchCreationService['create']>[1]
      ) => {
        creationCalls.push(
          input.recordsFieldValues.map((fields) =>
            String(fields.get(input.table.primaryFieldId().toString()))
          )
        );
        const createResult = input.table.createRecords(input.recordsFieldValues, {
          typecast: input.typecast,
        });
        if (createResult.isErr()) {
          return createResult;
        }
        return ok({
          records: createResult.value.records,
          events: [],
          fieldKeyMapping: createResult.value.fieldKeyMapping,
          undoCommands: [],
          redoCommands: [],
          afterCommit: async () => undefined,
        });
      },
    } as unknown as RecordBatchCreationService;

    const service = new PasteLinkAutoResolveService(
      new TableQueryService(new FakeTableRepository([foreignTable, hostTable])),
      new LinkTitleResolverService(
        new FakeTableRepository([foreignTable, hostTable]),
        new FakeRecordQueryRepository([
          {
            id: existingRecordId,
            fields: {
              [foreignTable.primaryFieldId().toString()]: 'Alpha',
            },
            version: 1,
          },
        ])
      ),
      fakeBatchCreateService
    );

    const linkField = hostTable.getFields().find((field) => field.type().toString() === 'link');
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const result = await service.resolve(createContext(), {
      table: hostTable,
      editableColumns: [{ fieldId: linkField.id(), columnIndex: 0 }],
      rowDataList: [['Alpha'], ['Beta'], ['Beta']],
    });

    const resolved = result._unsafeUnwrap();
    expect(creationCalls).toEqual([['Beta']]);
    expect(resolved.resolvedValues.get(linkField.id().toString())?.get('Alpha')).toEqual({
      id: existingRecordId,
      title: 'Alpha',
    });
    expect(resolved.resolvedValues.get(linkField.id().toString())?.get('Beta')?.id).toMatch(/^rec/);
  });

  it('reuses titles already resolved by a previous paste batch and skips creating them again', async () => {
    const foreignTable = buildTextTable('h', 'Foreign');
    const hostTable = buildHostTable(foreignTable.baseId(), foreignTable);
    const seedRecordId = `rec${'h'.repeat(16)}`;
    const creationCalls: Array<ReadonlyArray<string>> = [];
    const fakeBatchCreateService = {
      create: async (
        _context: IExecutionContext,
        input: Parameters<RecordBatchCreationService['create']>[1]
      ) => {
        creationCalls.push(
          input.recordsFieldValues.map((fields) =>
            String(fields.get(input.table.primaryFieldId().toString()))
          )
        );
        return err(domainError.unexpected({ message: 'should not create seeded title' }));
      },
    } as unknown as RecordBatchCreationService;

    const service = new PasteLinkAutoResolveService(
      new TableQueryService(new FakeTableRepository([foreignTable, hostTable])),
      new LinkTitleResolverService(
        new FakeTableRepository([foreignTable, hostTable]),
        new FakeRecordQueryRepository([])
      ),
      fakeBatchCreateService
    );

    const linkField = hostTable.getFields().find((field) => field.type().toString() === 'link');
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const result = await service.resolve(createContext(), {
      table: hostTable,
      editableColumns: [{ fieldId: linkField.id(), columnIndex: 0 }],
      rowDataList: [['Seeded']],
      existingResolvedValues: new Map([
        [linkField.id().toString(), new Map([['Seeded', { id: seedRecordId, title: 'Seeded' }]])],
      ]),
    });

    const resolved = result._unsafeUnwrap();
    expect(creationCalls).toEqual([]);
    expect(resolved.resolvedValues.get(linkField.id().toString())?.get('Seeded')).toEqual({
      id: seedRecordId,
      title: 'Seeded',
    });
  });

  it('keeps rec-prefixed titles unless they are canonical record ids', async () => {
    const foreignTable = buildTextTable('f', 'Foreign');
    const hostTable = buildHostTable(foreignTable.baseId(), foreignTable);
    const creationCalls: Array<ReadonlyArray<string>> = [];
    const fakeBatchCreateService = {
      create: async (
        _context: IExecutionContext,
        input: Parameters<RecordBatchCreationService['create']>[1]
      ) => {
        creationCalls.push(
          input.recordsFieldValues.map((fields) =>
            String(fields.get(input.table.primaryFieldId().toString()))
          )
        );
        const createResult = input.table.createRecords(input.recordsFieldValues, {
          typecast: input.typecast,
        });
        if (createResult.isErr()) {
          return createResult;
        }
        return ok({
          records: createResult.value.records,
          events: [],
          fieldKeyMapping: createResult.value.fieldKeyMapping,
          undoCommands: [],
          redoCommands: [],
          afterCommit: async () => undefined,
        });
      },
    } as unknown as RecordBatchCreationService;

    const service = new PasteLinkAutoResolveService(
      new TableQueryService(new FakeTableRepository([foreignTable, hostTable])),
      new LinkTitleResolverService(
        new FakeTableRepository([foreignTable, hostTable]),
        new FakeRecordQueryRepository([])
      ),
      fakeBatchCreateService
    );

    const linkField = hostTable.getFields().find((field) => field.type().toString() === 'link');
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const result = await service.resolve(createContext(), {
      table: hostTable,
      editableColumns: [{ fieldId: linkField.id(), columnIndex: 0 }],
      rowDataList: [['recipe, recaaaaaaaaaaaaaaaa, recommendation']],
    });

    const resolved = result._unsafeUnwrap();
    expect(creationCalls).toEqual([['recipe', 'recommendation']]);
    expect(resolved.resolvedValues.get(linkField.id().toString())?.has('recaaaaaaaaaaaaaaaa')).toBe(
      false
    );
    expect(resolved.resolvedValues.get(linkField.id().toString())?.get('recipe')?.id).toMatch(
      /^rec/
    );
    expect(
      resolved.resolvedValues.get(linkField.id().toString())?.get('recommendation')?.id
    ).toMatch(/^rec/);
  });

  it('propagates batch create errors when missing link titles cannot be created', async () => {
    const foreignTable = buildTextTable('g', 'Foreign');
    const hostTable = buildHostTable(foreignTable.baseId(), foreignTable);
    const service = new PasteLinkAutoResolveService(
      new TableQueryService(new FakeTableRepository([foreignTable, hostTable])),
      new LinkTitleResolverService(
        new FakeTableRepository([foreignTable, hostTable]),
        new FakeRecordQueryRepository([])
      ),
      {
        create: async () =>
          err(
            domainError.conflict({
              code: 'db.unique_violation',
              message: 'duplicate key value violates unique constraint',
            })
          ),
      } as unknown as RecordBatchCreationService
    );

    const linkField = hostTable.getFields().find((field) => field.type().toString() === 'link');
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const result = await service.resolve(createContext(), {
      table: hostTable,
      editableColumns: [{ fieldId: linkField.id(), columnIndex: 0 }],
      rowDataList: [['Missing']],
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('db.unique_violation');
  });

  it('rejects self-link auto-create', async () => {
    const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Self')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withName(FieldName.create('Self Link')._unsafeUnwrap())
      .withConfig(
        LinkFieldConfig.create({
          relationship: 'oneMany',
          foreignTableId: tableId.toString(),
          lookupFieldId: primaryFieldId.toString(),
          isOneWay: true,
        })._unsafeUnwrap()
      )
      .done();
    builder.view().defaultGrid().done();
    const hostTable = builder.build()._unsafeUnwrap();
    const linkField = hostTable.getFields().find((field) => field.type().toString() === 'link');
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const service = new PasteLinkAutoResolveService(
      new TableQueryService(new FakeTableRepository([hostTable])),
      new LinkTitleResolverService(
        new FakeTableRepository([hostTable]),
        new FakeRecordQueryRepository([])
      ),
      { create: async () => err(domainError.unexpected({ message: 'should not create' })) } as never
    );

    const result = await service.resolve(createContext(), {
      table: hostTable,
      editableColumns: [{ fieldId: linkField.id(), columnIndex: 0 }],
      rowDataList: [['Self']],
    });

    expect(result._unsafeUnwrapErr().code).toBe('paste.link_auto_create_self_link_unsupported');
  });

  it('rejects auto-create when lookup field is not the foreign primary field', async () => {
    const foreignTable = buildTextTable('c', 'Foreign');
    const altFieldId = foreignTable
      .getFields()
      .find((field) => !field.id().equals(foreignTable.primaryFieldId()))
      ?.id()
      .toString();
    expect(altFieldId).toBeDefined();
    if (!altFieldId) return;
    const hostTable = buildHostTable(foreignTable.baseId(), foreignTable, altFieldId);
    const linkField = hostTable.getFields().find((field) => field.type().toString() === 'link');
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const service = new PasteLinkAutoResolveService(
      new TableQueryService(new FakeTableRepository([foreignTable, hostTable])),
      new LinkTitleResolverService(
        new FakeTableRepository([foreignTable, hostTable]),
        new FakeRecordQueryRepository([])
      ),
      { create: async () => err(domainError.unexpected({ message: 'should not create' })) } as never
    );

    const result = await service.resolve(createContext(), {
      table: hostTable,
      editableColumns: [{ fieldId: linkField.id(), columnIndex: 0 }],
      rowDataList: [['Missing']],
    });

    expect(result._unsafeUnwrapErr().code).toBe('paste.link_auto_create_requires_primary_lookup');
  });

  it('rejects auto-create when the foreign primary field is computed', async () => {
    const foreignTable = buildFormulaPrimaryTable('d', 'Formula Primary');
    const hostTable = buildHostTable(foreignTable.baseId(), foreignTable);
    const linkField = hostTable.getFields().find((field) => field.type().toString() === 'link');
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const service = new PasteLinkAutoResolveService(
      new TableQueryService(new FakeTableRepository([foreignTable, hostTable])),
      new LinkTitleResolverService(
        new FakeTableRepository([foreignTable, hostTable]),
        new FakeRecordQueryRepository([])
      ),
      { create: async () => err(domainError.unexpected({ message: 'should not create' })) } as never
    );

    const result = await service.resolve(createContext(), {
      table: hostTable,
      editableColumns: [{ fieldId: linkField.id(), columnIndex: 0 }],
      rowDataList: [['Missing']],
    });

    expect(result._unsafeUnwrapErr().code).toBe(
      'paste.link_auto_create_computed_primary_unsupported'
    );
  });

  it('rejects auto-create when the foreign table has other required fields without defaults', async () => {
    const foreignTable = buildTableWithBlockingRequiredField('e', 'Blocking Required');
    const hostTable = buildHostTable(foreignTable.baseId(), foreignTable);
    const linkField = hostTable.getFields().find((field) => field.type().toString() === 'link');
    expect(linkField).toBeDefined();
    if (!linkField) return;

    const service = new PasteLinkAutoResolveService(
      new TableQueryService(new FakeTableRepository([foreignTable, hostTable])),
      new LinkTitleResolverService(
        new FakeTableRepository([foreignTable, hostTable]),
        new FakeRecordQueryRepository([])
      ),
      { create: async () => err(domainError.unexpected({ message: 'should not create' })) } as never
    );

    const result = await service.resolve(createContext(), {
      table: hostTable,
      editableColumns: [{ fieldId: linkField.id(), columnIndex: 0 }],
      rowDataList: [['Missing']],
    });

    expect(result._unsafeUnwrapErr().code).toBe('paste.link_auto_create_missing_required_fields');
  });
});
