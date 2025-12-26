import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableName } from '../TableName';

const buildTable = (baseId: BaseId, name: TableName) => {
  const fieldNameResult = FieldName.create('Name');
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

describe('TableSpecBuilder', () => {
  it('includes base id spec by default', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const otherBaseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    expect([baseIdResult, otherBaseIdResult, nameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || otherBaseIdResult.isErr() || nameResult.isErr()) return;

    const table = buildTable(baseIdResult.value, nameResult.value);
    const otherBaseTable = buildTable(otherBaseIdResult.value, nameResult.value);
    if (!table || !otherBaseTable) return;

    const specResult = Table.specs(baseIdResult.value).byName(nameResult.value).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;

    expect(specResult.value.isSatisfiedBy(table)).toBe(true);
    expect(specResult.value.isSatisfiedBy(otherBaseTable)).toBe(false);
  });

  it('can exclude base id spec explicitly', () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const otherBaseIdResult = BaseId.create(`bse${'d'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    expect([baseIdResult, otherBaseIdResult, nameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || otherBaseIdResult.isErr() || nameResult.isErr()) return;

    const table = buildTable(baseIdResult.value, nameResult.value);
    const otherBaseTable = buildTable(otherBaseIdResult.value, nameResult.value);
    if (!table || !otherBaseTable) return;

    const specResult = Table.specs(baseIdResult.value)
      .withoutBaseId()
      .byName(nameResult.value)
      .build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;

    expect(specResult.value.isSatisfiedBy(table)).toBe(true);
    expect(specResult.value.isSatisfiedBy(otherBaseTable)).toBe(true);
  });

  it('supports nested or groups', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const otherNameResult = TableName.create('Tasks');
    expect([baseIdResult, nameResult, otherNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || nameResult.isErr() || otherNameResult.isErr()) return;

    const table = buildTable(baseIdResult.value, nameResult.value);
    const otherTable = buildTable(baseIdResult.value, otherNameResult.value);
    if (!table || !otherTable) return;

    const specResult = Table.specs(baseIdResult.value)
      .orGroup((b) => b.byName(nameResult.value).byName(otherNameResult.value))
      .build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;

    expect(specResult.value.isSatisfiedBy(table)).toBe(true);
    expect(specResult.value.isSatisfiedBy(otherTable)).toBe(true);
  });

  it('supports not specs', () => {
    const baseIdResult = BaseId.create(`bse${'f'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const otherNameResult = TableName.create('Tasks');
    expect([baseIdResult, nameResult, otherNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || nameResult.isErr() || otherNameResult.isErr()) return;

    const table = buildTable(baseIdResult.value, nameResult.value);
    const otherTable = buildTable(baseIdResult.value, otherNameResult.value);
    if (!table || !otherTable) return;

    const specResult = Table.specs(baseIdResult.value)
      .not((b) => b.byName(nameResult.value))
      .build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;

    expect(specResult.value.isSatisfiedBy(table)).toBe(false);
    expect(specResult.value.isSatisfiedBy(otherTable)).toBe(true);
  });

  it('supports name like specs', () => {
    const baseIdResult = BaseId.create(`bse${'g'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const otherNameResult = TableName.create('Tasks');
    const queryNameResult = TableName.create('Pro');
    expect(
      [baseIdResult, nameResult, otherNameResult, queryNameResult].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      nameResult.isErr() ||
      otherNameResult.isErr() ||
      queryNameResult.isErr()
    )
      return;

    const table = buildTable(baseIdResult.value, nameResult.value);
    const otherTable = buildTable(baseIdResult.value, otherNameResult.value);
    if (!table || !otherTable) return;

    const specResult = Table.specs(baseIdResult.value).byNameLike(queryNameResult.value).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;

    expect(specResult.value.isSatisfiedBy(table)).toBe(true);
    expect(specResult.value.isSatisfiedBy(otherTable)).toBe(false);
  });

  it('supports id list specs', () => {
    const baseIdResult = BaseId.create(`bse${'h'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const otherNameResult = TableName.create('Tasks');
    expect([baseIdResult, nameResult, otherNameResult].every((r) => r.isOk())).toBe(true);
    if (baseIdResult.isErr() || nameResult.isErr() || otherNameResult.isErr()) return;

    const table = buildTable(baseIdResult.value, nameResult.value);
    const otherTable = buildTable(baseIdResult.value, otherNameResult.value);
    if (!table || !otherTable) return;

    const specResult = Table.specs(baseIdResult.value).withoutBaseId().byIds([table.id()]).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;

    expect(specResult.value.isSatisfiedBy(table)).toBe(true);
    expect(specResult.value.isSatisfiedBy(otherTable)).toBe(false);
  });
});
