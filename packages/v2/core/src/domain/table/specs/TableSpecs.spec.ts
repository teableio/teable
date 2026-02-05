import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import type { ISpecification } from '../../shared/specification/ISpecification';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableName } from '../TableName';
import type { ITableSpecVisitor } from './ITableSpecVisitor';
import type { TableAddFieldSpec } from './TableAddFieldSpec';
import type { TableAddSelectOptionsSpec } from './TableAddSelectOptionsSpec';
import { TableByBaseIdSpec } from './TableByBaseIdSpec';
import { TableByIdSpec } from './TableByIdSpec';
import { TableByIdsSpec } from './TableByIdsSpec';
import { TableByNameLikeSpec } from './TableByNameLikeSpec';
import { TableByNameSpec } from './TableByNameSpec';
import type { TableDuplicateFieldSpec } from './TableDuplicateFieldSpec';
import type { TableRemoveFieldSpec } from './TableRemoveFieldSpec';
import type { TableRenameSpec } from './TableRenameSpec';
import type { TableUpdateViewColumnMetaSpec } from './TableUpdateViewColumnMetaSpec';

class SpyVisitor implements ITableSpecVisitor {
  readonly calls: string[] = [];

  visit(_: ISpecification): ReturnType<ITableSpecVisitor['visit']> {
    return ok(undefined);
  }

  visitTableAddField(_: TableAddFieldSpec): ReturnType<ITableSpecVisitor['visitTableAddField']> {
    this.calls.push('TableAddFieldSpec');
    return ok(undefined);
  }

  visitTableAddSelectOptions(
    _: TableAddSelectOptionsSpec
  ): ReturnType<ITableSpecVisitor['visitTableAddSelectOptions']> {
    this.calls.push('TableAddSelectOptionsSpec');
    return ok(undefined);
  }

  visitTableDuplicateField(
    _: TableDuplicateFieldSpec
  ): ReturnType<ITableSpecVisitor['visitTableDuplicateField']> {
    this.calls.push('TableDuplicateFieldSpec');
    return ok(undefined);
  }

  visitTableRemoveField(
    _: TableRemoveFieldSpec
  ): ReturnType<ITableSpecVisitor['visitTableRemoveField']> {
    this.calls.push('TableRemoveFieldSpec');
    return ok(undefined);
  }

  visitTableUpdateViewColumnMeta(
    _: TableUpdateViewColumnMetaSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewColumnMeta']> {
    this.calls.push('TableUpdateViewColumnMetaSpec');
    return ok(undefined);
  }

  visitTableByBaseId(_: TableByBaseIdSpec): ReturnType<ITableSpecVisitor['visitTableByBaseId']> {
    this.calls.push('TableByBaseIdSpec');
    return ok(undefined);
  }

  visitTableById(_: TableByIdSpec): ReturnType<ITableSpecVisitor['visitTableById']> {
    this.calls.push('TableByIdSpec');
    return ok(undefined);
  }

  visitTableByIds(_: TableByIdsSpec): ReturnType<ITableSpecVisitor['visitTableByIds']> {
    this.calls.push('TableByIdsSpec');
    return ok(undefined);
  }

  visitTableByName(_: TableByNameSpec): ReturnType<ITableSpecVisitor['visitTableByName']> {
    this.calls.push('TableByNameSpec');
    return ok(undefined);
  }

  visitTableByNameLike(
    _: TableByNameLikeSpec
  ): ReturnType<ITableSpecVisitor['visitTableByNameLike']> {
    this.calls.push('TableByNameLikeSpec');
    return ok(undefined);
  }

  visitTableRename(_: TableRenameSpec): ReturnType<ITableSpecVisitor['visitTableRename']> {
    this.calls.push('TableRenameSpec');
    return ok(undefined);
  }
}

const buildTable = (baseId: BaseId, name: TableName) => {
  const fieldNameResult = FieldName.create('Title');
  fieldNameResult._unsafeUnwrap();
  undefined;
  const builder = Table.builder().withBaseId(baseId).withName(name);
  builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const tableResult = builder.build();
  tableResult._unsafeUnwrap();
  undefined;
  return tableResult._unsafeUnwrap();
};

describe('Table specs', () => {
  it('evaluates base id spec', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const otherBaseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    [baseIdResult, otherBaseIdResult, nameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    otherBaseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    if (!table) return;

    const spec = TableByBaseIdSpec.create(baseIdResult._unsafeUnwrap());
    expect(spec.isSatisfiedBy(table)).toBe(true);
    expect(
      spec.isSatisfiedBy(
        buildTable(otherBaseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap()) ?? table
      )
    ).toBe(false);
    const mutateResult = spec.mutate(table);
    mutateResult._unsafeUnwrap();
    const visitor = new SpyVisitor();
    spec.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableByBaseIdSpec');
  });

  it('evaluates id and name specs', () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const nameResult = TableName.create('Tasks');
    const otherNameResult = TableName.create('Other');
    [baseIdResult, nameResult, otherNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();
    otherNameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    if (!table) return;

    const byId = TableByIdSpec.create(table.id());
    expect(byId.isSatisfiedBy(table)).toBe(true);
    const byIds = TableByIdsSpec.create([table.id()]);
    expect(byIds.isSatisfiedBy(table)).toBe(true);
    const byName = TableByNameSpec.create(nameResult._unsafeUnwrap());
    expect(byName.isSatisfiedBy(table)).toBe(true);
    const byOtherName = TableByNameSpec.create(otherNameResult._unsafeUnwrap());
    expect(byOtherName.isSatisfiedBy(table)).toBe(false);

    const mutateResult = byOtherName.mutate(table);
    mutateResult._unsafeUnwrap();

    expect(mutateResult._unsafeUnwrap().name().toString()).toBe(
      otherNameResult._unsafeUnwrap().toString()
    );
    expect(table.name().toString()).toBe(nameResult._unsafeUnwrap().toString());

    const visitor = new SpyVisitor();
    byId.accept(visitor)._unsafeUnwrap();
    byIds.accept(visitor)._unsafeUnwrap();
    byName.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableByIdSpec');
    expect(visitor.calls).toContain('TableByIdsSpec');
    expect(visitor.calls).toContain('TableByNameSpec');
  });

  it('evaluates name like specs', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const queryNameResult = TableName.create('Pro');
    const otherNameResult = TableName.create('Tasks');
    [baseIdResult, nameResult, queryNameResult, otherNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();
    queryNameResult._unsafeUnwrap();
    otherNameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    const otherTable = buildTable(baseIdResult._unsafeUnwrap(), otherNameResult._unsafeUnwrap());
    if (!table || !otherTable) return;

    const spec = TableByNameLikeSpec.create(queryNameResult._unsafeUnwrap());
    expect(spec.isSatisfiedBy(table)).toBe(true);
    expect(spec.isSatisfiedBy(otherTable)).toBe(false);

    const visitor = new SpyVisitor();
    spec.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableByNameLikeSpec');
  });
});
