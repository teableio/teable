import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import type { ISpecification } from '../../shared/specification/ISpecification';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableName } from '../TableName';
import type { ITableSpecVisitor } from './ITableSpecVisitor';
import type { TableAddFieldSpec } from './TableAddFieldSpec';
import { TableByBaseIdSpec } from './TableByBaseIdSpec';
import { TableByIdSpec } from './TableByIdSpec';
import { TableByIdsSpec } from './TableByIdsSpec';
import { TableByNameLikeSpec } from './TableByNameLikeSpec';
import { TableByNameSpec } from './TableByNameSpec';
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
}

const buildTable = (baseId: BaseId, name: TableName) => {
  const fieldNameResult = FieldName.create('Title');
  expect(fieldNameResult.isOk()).toBe(true);
  if (fieldNameResult.isErr()) return undefined;
  const builder = Table.builder().withBaseId(baseId).withName(name);
  builder.field().singleLineText().withName(fieldNameResult.value).done();
  builder.view().defaultGrid().done();
  const tableResult = builder.build();
  expect(tableResult.isOk()).toBe(true);
  if (tableResult.isErr()) return undefined;
  return tableResult.value;
};

describe('Table specs', () => {
  it('evaluates base id spec', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const otherBaseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    expect([baseIdResult, otherBaseIdResult, nameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || otherBaseIdResult.isErr() || nameResult.isErr()) return;

    const table = buildTable(baseIdResult.value, nameResult.value);
    if (!table) return;

    const spec = TableByBaseIdSpec.create(baseIdResult.value);
    expect(spec.isSatisfiedBy(table)).toBe(true);
    expect(spec.isSatisfiedBy(buildTable(otherBaseIdResult.value, nameResult.value) ?? table)).toBe(
      false
    );
    const mutateResult = spec.mutate(table);
    expect(mutateResult.isOk()).toBe(true);
    const visitor = new SpyVisitor();
    expect(spec.accept(visitor).isOk()).toBe(true);
    expect(visitor.calls).toContain('TableByBaseIdSpec');
  });

  it('evaluates id and name specs', () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const nameResult = TableName.create('Tasks');
    const otherNameResult = TableName.create('Other');
    expect([baseIdResult, nameResult, otherNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || nameResult.isErr() || otherNameResult.isErr()) return;

    const table = buildTable(baseIdResult.value, nameResult.value);
    if (!table) return;

    const byId = TableByIdSpec.create(table.id());
    expect(byId.isSatisfiedBy(table)).toBe(true);
    const byIds = TableByIdsSpec.create([table.id()]);
    expect(byIds.isSatisfiedBy(table)).toBe(true);
    const byName = TableByNameSpec.create(nameResult.value);
    expect(byName.isSatisfiedBy(table)).toBe(true);
    const byOtherName = TableByNameSpec.create(otherNameResult.value);
    expect(byOtherName.isSatisfiedBy(table)).toBe(false);

    const mutateResult = byOtherName.mutate(table);
    expect(mutateResult.isOk()).toBe(true);
    if (mutateResult.isErr()) return;
    expect(mutateResult.value.name().toString()).toBe(otherNameResult.value.toString());
    expect(table.name().toString()).toBe(nameResult.value.toString());

    const visitor = new SpyVisitor();
    expect(byId.accept(visitor).isOk()).toBe(true);
    expect(byIds.accept(visitor).isOk()).toBe(true);
    expect(byName.accept(visitor).isOk()).toBe(true);
    expect(visitor.calls).toContain('TableByIdSpec');
    expect(visitor.calls).toContain('TableByIdsSpec');
    expect(visitor.calls).toContain('TableByNameSpec');
  });

  it('evaluates name like specs', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const queryNameResult = TableName.create('Pro');
    const otherNameResult = TableName.create('Tasks');
    expect(
      [baseIdResult, nameResult, queryNameResult, otherNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      nameResult.isErr() ||
      queryNameResult.isErr() ||
      otherNameResult.isErr()
    )
      return;

    const table = buildTable(baseIdResult.value, nameResult.value);
    const otherTable = buildTable(baseIdResult.value, otherNameResult.value);
    if (!table || !otherTable) return;

    const spec = TableByNameLikeSpec.create(queryNameResult.value);
    expect(spec.isSatisfiedBy(table)).toBe(true);
    expect(spec.isSatisfiedBy(otherTable)).toBe(false);

    const visitor = new SpyVisitor();
    expect(spec.accept(visitor).isOk()).toBe(true);
    expect(visitor.calls).toContain('TableByNameLikeSpec');
  });
});
