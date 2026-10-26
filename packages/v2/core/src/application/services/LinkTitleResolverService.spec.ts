import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { AndSpec } from '../../domain/shared/specification/AndSpec';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { OrSpec } from '../../domain/shared/specification/OrSpec';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import { SelectOption } from '../../domain/table/fields/types/SelectOption';
import { RecordId } from '../../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { isRecordConditionLiteralValue } from '../../domain/table/records/specs/RecordConditionValues';
import { SetLinkValueByTitleSpec } from '../../domain/table/records/specs/values/SetLinkValueByTitleSpec';
import { SetLinkValueSpec } from '../../domain/table/records/specs/values/SetLinkValueSpec';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import { CellValue } from '../../domain/table/records/values/CellValue';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { ITableRepository } from '../../ports/TableRepository';
import { LinkTitleResolverService } from './LinkTitleResolverService';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const collectQueryLiterals = (
  spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined
): string[] => {
  if (!spec) return [];
  if (spec instanceof OrSpec) {
    return [...collectQueryLiterals(spec.leftSpec()), ...collectQueryLiterals(spec.rightSpec())];
  }
  if ('value' in spec && typeof spec.value === 'function') {
    const value = spec.value();
    return isRecordConditionLiteralValue(value) ? [String(value.toValue())] : [];
  }
  return [];
};

const buildTextTable = (baseSeed: string, tableSeed: string) => {
  const baseId = BaseId.create(`bse${baseSeed.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${tableSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create(`Table ${tableSeed}`)._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).primary().done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildLongTextTable = (baseSeed: string, tableSeed: string) => {
  const baseId = BaseId.create(`bse${baseSeed.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${tableSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create(`Table ${tableSeed}`)._unsafeUnwrap();
  const fieldName = FieldName.create('Notes')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder.field().longText().withName(fieldName).primary().done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildNumberTable = (baseSeed: string, tableSeed: string) => {
  const baseId = BaseId.create(`bse${baseSeed.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${tableSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create(`Table ${tableSeed}`)._unsafeUnwrap();
  const fieldName = FieldName.create('Value')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder.field().number().withName(fieldName).primary().done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildFormulaTextTable = (baseSeed: string, tableSeed: string) => {
  const baseId = BaseId.create(`bse${baseSeed.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${tableSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create(`Table ${tableSeed}`)._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .formula()
    .withName(fieldName)
    .withExpression(FormulaExpression.create("'Alpha'")._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

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

  async restore() {
    return ok(undefined);
  }

  async delete() {
    return ok(undefined);
  }
}

class FakeRecordQueryRepository implements ITableRecordQueryRepository {
  public lastSpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined;
  public findCalls = 0;

  constructor(private readonly records: ReadonlyArray<TableRecordReadModel>) {}

  async find(
    _context: IExecutionContext,
    _table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ) {
    this.findCalls += 1;
    this.lastSpec = spec;
    const literals = new Set(collectQueryLiterals(spec));
    const records = spec
      ? this.records.filter((record) =>
          Object.values(record.fields).some((value) => literals.has(String(value)))
        )
      : this.records;
    return ok({ records, total: records.length });
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

describe('LinkTitleResolverService', () => {
  it('extracts link title specs and detects resolution needs', () => {
    const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetLinkValueByTitleSpec.create(fieldId, foreignTableId, ['Alpha']);

    const service = new LinkTitleResolverService(
      new FakeTableRepository(buildTextTable('a', 'c')),
      new FakeRecordQueryRepository([])
    );

    const extracted = service.extractLinkTitleSpecs(spec)._unsafeUnwrap();
    expect(extracted).toHaveLength(1);
    expect(service.needsResolution(spec)).toBe(true);

    const idSpec = new SetLinkValueSpec(
      fieldId,
      CellValue.fromValidated([{ id: `rec${'c'.repeat(16)}` }]),
      foreignTableId
    );
    expect(service.needsResolution(idSpec)).toBe(false);
  });

  it('resolves titles to record ids', async () => {
    const table = buildTextTable('a', 'd');
    const recordId = RecordId.create(`rec${'e'.repeat(16)}`)._unsafeUnwrap();
    const records: TableRecordReadModel[] = [
      {
        id: recordId.toString(),
        fields: {
          [table.primaryFieldId().toString()]: 'Alpha',
        },
        version: 1,
      },
    ];

    const recordQueryRepository = new FakeRecordQueryRepository(records);
    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      recordQueryRepository
    );

    const fieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      { fieldId, foreignTableId: table.id(), titles: ['Alpha', 'Missing'] },
    ]);

    const resolved = result._unsafeUnwrap()[0];
    expect(resolved.resolvedIds).toEqual([{ id: recordId.toString(), title: 'Alpha' }]);
    expect(recordQueryRepository.lastSpec).toBeInstanceOf(OrSpec);
  });

  it('resolves titles against the link display field instead of the primary', async () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Targets')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.field().singleLineText().withName(FieldName.create('Code')._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const primaryFieldId = table.primaryFieldId().toString();
    const displayFieldId = table
      .getFields()
      .find((field) => !field.id().equals(table.primaryFieldId()))!
      .id();
    const recordId = `rec${'v'.repeat(16)}`;

    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository([
        {
          id: recordId,
          fields: { [primaryFieldId]: 'Primary A', [displayFieldId.toString()]: 'Alpha' },
          version: 1,
        },
      ])
    );

    const fieldId = FieldId.create(`fld${'v'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      {
        fieldId,
        foreignTableId: table.id(),
        lookupFieldId: displayFieldId,
        titles: ['Alpha', 'Primary A'],
      },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([{ id: recordId, title: 'Alpha' }]);
  });

  it('does not resolve titles against a multi-value display field', async () => {
    const baseId = BaseId.create(`bse${'m'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'m'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Targets')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.field().multipleSelect().withName(FieldName.create('Tags')._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const displayFieldId = table
      .getFields()
      .find((field) => !field.id().equals(table.primaryFieldId()))!
      .id();

    const recordQueryRepository = new FakeRecordQueryRepository([]);
    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      recordQueryRepository
    );

    const fieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      {
        fieldId,
        foreignTableId: table.id(),
        lookupFieldId: displayFieldId,
        titles: ['Alpha'],
      },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([]);
    expect(recordQueryRepository.findCalls).toBe(0);
  });

  it('resolves a single-select display value stored as the option name', async () => {
    const baseId = BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Targets')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .singleSelect()
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions([
        SelectOption.create({ id: 'choDone', name: 'Done', color: 'green' })._unsafeUnwrap(),
        SelectOption.create({ id: 'choTrap', name: 'choDone', color: 'blue' })._unsafeUnwrap(),
      ])
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const displayFieldId = table
      .getFields()
      .find((field) => !field.id().equals(table.primaryFieldId()))!
      .id();
    const recordId = `rec${'s'.repeat(16)}`;
    const trapRecordId = `rec${'t'.repeat(16)}`;

    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository([
        {
          id: recordId,
          fields: { [displayFieldId.toString()]: 'Done' },
          version: 1,
        },
        {
          id: trapRecordId,
          fields: { [displayFieldId.toString()]: 'choDone' },
          version: 1,
        },
      ])
    );

    const fieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      {
        fieldId,
        foreignTableId: table.id(),
        lookupFieldId: displayFieldId,
        titles: ['Done'],
      },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([{ id: recordId, title: 'Done' }]);
  });

  it('falls back to the foreign primary when the display field is a checkbox', async () => {
    const baseId = BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Targets')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.field().checkbox().withName(FieldName.create('Done')._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const displayFieldId = table
      .getFields()
      .find((field) => !field.id().equals(table.primaryFieldId()))!
      .id();
    const recordId = `rec${'c'.repeat(16)}`;

    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository([
        {
          id: recordId,
          fields: { [table.primaryFieldId().toString()]: 'Alpha' },
          version: 1,
        },
      ])
    );

    const fieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      {
        fieldId,
        foreignTableId: table.id(),
        lookupFieldId: displayFieldId,
        titles: ['Alpha'],
      },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([{ id: recordId, title: 'Alpha' }]);
  });

  it('resolves numeric titles when the primary field is a number', async () => {
    const table = buildNumberTable('a', 'g');
    const recordId = `rec${'h'.repeat(16)}`;
    const records: TableRecordReadModel[] = [
      {
        id: recordId,
        fields: {
          [table.primaryFieldId().toString()]: 123,
        },
        version: 1,
      },
    ];

    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository(records)
    );

    const fieldId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      { fieldId, foreignTableId: table.id(), titles: ['123.0'] },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([{ id: recordId, title: '123.0' }]);
  });

  it('resolves titles when the primary field is a string formula', async () => {
    const table = buildFormulaTextTable('a', 'z');
    const recordId = RecordId.create(`rec${'z'.repeat(16)}`)._unsafeUnwrap();
    const records: TableRecordReadModel[] = [
      {
        id: recordId.toString(),
        fields: {
          [table.primaryFieldId().toString()]: 'Alpha',
        },
        version: 1,
      },
    ];

    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository(records)
    );

    const fieldId = FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      { fieldId, foreignTableId: table.id(), titles: ['Alpha'] },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([
      { id: recordId.toString(), title: 'Alpha' },
    ]);
  });

  it('replaces title specs with link id specs', async () => {
    const table = buildTextTable('a', 'j');
    const recordId = RecordId.create(`rec${'k'.repeat(16)}`)._unsafeUnwrap();
    const records: TableRecordReadModel[] = [
      {
        id: recordId.toString(),
        fields: {
          [table.primaryFieldId().toString()]: 'Alpha',
        },
        version: 1,
      },
    ];

    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository(records)
    );

    const fieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
    const titleSpec = SetLinkValueByTitleSpec.create(fieldId, table.id(), ['Alpha']);
    const spec = new AndSpec(titleSpec, titleSpec);

    const result = await service.resolveAndReplace(createContext(), spec);
    const replaced = result._unsafeUnwrap();

    expect(replaced).toBeInstanceOf(AndSpec);
    const left = (replaced as AndSpec<unknown>).leftSpec();
    expect(left).toBeInstanceOf(SetLinkValueSpec);
    const leftValue = (left as SetLinkValueSpec).value.toValue();
    expect(leftValue).toEqual([{ id: recordId.toString(), title: 'Alpha' }]);
  });

  it('unwraps a single-relationship typecast title to a link object', async () => {
    const table = buildTextTable('a', 'p');
    const recordId = RecordId.create(`rec${'q'.repeat(16)}`)._unsafeUnwrap();
    const records: TableRecordReadModel[] = [
      {
        id: recordId.toString(),
        fields: {
          [table.primaryFieldId().toString()]: 'Owner A',
        },
        version: 1,
      },
    ];

    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository(records)
    );

    const fieldId = FieldId.create(`fld${'r'.repeat(16)}`)._unsafeUnwrap();
    const titleSpec = SetLinkValueByTitleSpec.create(fieldId, table.id(), ['Owner A'], false);
    const result = await service.resolveAndReplace(createContext(), titleSpec);
    const replaced = result._unsafeUnwrap();

    expect(replaced).toBeInstanceOf(SetLinkValueSpec);
    expect((replaced as SetLinkValueSpec).value.toValue()).toEqual({
      id: recordId.toString(),
      title: 'Owner A',
    });
  });

  it('skips querying when all requested titles are empty', async () => {
    const table = buildTextTable('a', 'm');
    const recordQueryRepository = new FakeRecordQueryRepository([]);
    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      recordQueryRepository
    );

    const fieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      { fieldId, foreignTableId: table.id(), titles: ['', ''] },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([]);
    expect(recordQueryRepository.findCalls).toBe(0);
  });

  it('matches a stored single-line title when the request still has newlines or tabs', async () => {
    const table = buildTextTable('a', 'w');
    const recordId = RecordId.create(`rec${'w'.repeat(16)}`)._unsafeUnwrap();
    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository([
        {
          id: recordId.toString(),
          fields: { [table.primaryFieldId().toString()]: 'A B' },
          version: 1,
        },
      ])
    );
    const fieldId = FieldId.create(`fld${'w'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      { fieldId, foreignTableId: table.id(), titles: ['A\nB'] },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([
      { id: recordId.toString(), title: 'A\nB' },
    ]);
  });

  it('still resolves a legacy single-line primary that stores the newline', async () => {
    const table = buildTextTable('a', 'y');
    const recordId = RecordId.create(`rec${'y'.repeat(16)}`)._unsafeUnwrap();
    const recordQueryRepository = new FakeRecordQueryRepository([
      {
        id: recordId.toString(),
        fields: { [table.primaryFieldId().toString()]: 'A\nB' },
        version: 1,
      },
    ]);
    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      recordQueryRepository
    );
    const fieldId = FieldId.create(`fld${'y'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      { fieldId, foreignTableId: table.id(), titles: ['A\nB'] },
    ]);

    expect(collectQueryLiterals(recordQueryRepository.lastSpec).sort()).toEqual(['A\nB', 'A B']);
    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([
      { id: recordId.toString(), title: 'A\nB' },
    ]);
  });

  it('resolves a legacy tab-only single-line primary by exact title', async () => {
    const table = buildTextTable('a', 't');
    const recordId = RecordId.create(`rec${'t'.repeat(16)}`)._unsafeUnwrap();
    const recordQueryRepository = new FakeRecordQueryRepository([
      {
        id: recordId.toString(),
        fields: { [table.primaryFieldId().toString()]: '\t' },
        version: 1,
      },
    ]);
    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      recordQueryRepository
    );
    const fieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      { fieldId, foreignTableId: table.id(), titles: ['\t'] },
    ]);

    expect(collectQueryLiterals(recordQueryRepository.lastSpec)).toEqual(['\t']);
    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([
      { id: recordId.toString(), title: '\t' },
    ]);
  });

  it('links each single-line title to its own record when both forms exist', async () => {
    const table = buildTextTable('a', 'v');
    const legacyId = RecordId.create(`rec${'v'.repeat(16)}`)._unsafeUnwrap();
    const normalizedId = RecordId.create(`rec${'u'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = table.primaryFieldId().toString();
    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository([
        { id: legacyId.toString(), fields: { [primaryFieldId]: 'A\nB' }, version: 1 },
        { id: normalizedId.toString(), fields: { [primaryFieldId]: 'A B' }, version: 1 },
      ])
    );
    const fieldId = FieldId.create(`fld${'v'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      { fieldId, foreignTableId: table.id(), titles: ['A\nB', 'A B'] },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([
      { id: legacyId.toString(), title: 'A\nB' },
      { id: normalizedId.toString(), title: 'A B' },
    ]);
  });

  it('does not collapse newlines when the foreign primary is long text', async () => {
    const table = buildLongTextTable('a', 'x');
    const recordId = RecordId.create(`rec${'x'.repeat(16)}`)._unsafeUnwrap();
    const service = new LinkTitleResolverService(
      new FakeTableRepository(table),
      new FakeRecordQueryRepository([
        {
          id: recordId.toString(),
          fields: { [table.primaryFieldId().toString()]: 'A\nB' },
          version: 1,
        },
      ])
    );
    const fieldId = FieldId.create(`fld${'x'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.resolve(createContext(), [
      { fieldId, foreignTableId: table.id(), titles: ['A\nB', 'A B'] },
    ]);

    expect(result._unsafeUnwrap()[0]?.resolvedIds).toEqual([
      { id: recordId.toString(), title: 'A\nB' },
    ]);
  });
});
