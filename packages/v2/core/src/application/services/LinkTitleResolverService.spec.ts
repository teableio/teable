import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { AndSpec } from '../../domain/shared/specification/AndSpec';
import { OrSpec } from '../../domain/shared/specification/OrSpec';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { RecordId } from '../../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { SetLinkValueByTitleSpec } from '../../domain/table/records/specs/values/SetLinkValueByTitleSpec';
import { SetLinkValueSpec } from '../../domain/table/records/specs/values/SetLinkValueSpec';
import { CellValue } from '../../domain/table/records/values/CellValue';
import type { TableRecord } from '../../domain/table/records/TableRecord';
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

  it('returns validation error for non-text primary field', async () => {
    const table = buildNumberTable('a', 'g');
    const records: TableRecordReadModel[] = [
      {
        id: `rec${'h'.repeat(16)}`,
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
      { fieldId, foreignTableId: table.id(), titles: ['123'] },
    ]);

    expect(result._unsafeUnwrapErr().message).toBe(
      'Primary field must be a single line text field for title resolution'
    );
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
});
