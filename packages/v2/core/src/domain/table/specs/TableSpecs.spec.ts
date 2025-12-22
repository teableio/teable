import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableName } from '../TableName';
import { TableByBaseIdSpec } from './TableByBaseIdSpec';
import { TableByIdSpec } from './TableByIdSpec';
import { TableByNameSpec } from './TableByNameSpec';

class SpyVisitor implements ISpecVisitor {
  readonly calls: string[] = [];

  visit(spec: ISpecification): ReturnType<ISpecVisitor['visit']> {
    this.calls.push(spec.constructor.name);
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
    const byName = TableByNameSpec.create(nameResult.value);
    expect(byName.isSatisfiedBy(table)).toBe(true);
    const byOtherName = TableByNameSpec.create(otherNameResult.value);
    expect(byOtherName.isSatisfiedBy(table)).toBe(false);

    const visitor = new SpyVisitor();
    expect(byId.accept(visitor).isOk()).toBe(true);
    expect(byName.accept(visitor).isOk()).toBe(true);
    expect(visitor.calls).toContain('TableByIdSpec');
    expect(visitor.calls).toContain('TableByNameSpec');
  });
});
