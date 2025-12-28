import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldName } from '../fields/FieldName';
import { Table } from '../Table';
import { TableName } from '../TableName';

const buildTable = (baseId: BaseId, name: TableName) => {
  const fieldNameResult = FieldName.create('Name');
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

describe('TableSpecBuilder', () => {
  it('includes base id spec by default', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const otherBaseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    [baseIdResult, otherBaseIdResult, nameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    otherBaseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    const otherBaseTable = buildTable(
      otherBaseIdResult._unsafeUnwrap(),
      nameResult._unsafeUnwrap()
    );
    if (!table || !otherBaseTable) return;

    const specResult = table.specs().byName(nameResult._unsafeUnwrap()).build();
    specResult._unsafeUnwrap();

    expect(specResult._unsafeUnwrap().isSatisfiedBy(table)).toBe(true);
    expect(specResult._unsafeUnwrap().isSatisfiedBy(otherBaseTable)).toBe(false);
  });

  it('can exclude base id spec explicitly', () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const otherBaseIdResult = BaseId.create(`bse${'d'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    [baseIdResult, otherBaseIdResult, nameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    otherBaseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    const otherBaseTable = buildTable(
      otherBaseIdResult._unsafeUnwrap(),
      nameResult._unsafeUnwrap()
    );
    if (!table || !otherBaseTable) return;

    const specResult = table.specs().withoutBaseId().byName(nameResult._unsafeUnwrap()).build();
    specResult._unsafeUnwrap();

    expect(specResult._unsafeUnwrap().isSatisfiedBy(table)).toBe(true);
    expect(specResult._unsafeUnwrap().isSatisfiedBy(otherBaseTable)).toBe(true);
  });

  it('supports nested or groups', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const otherNameResult = TableName.create('Tasks');
    [baseIdResult, nameResult, otherNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();
    otherNameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    const otherTable = buildTable(baseIdResult._unsafeUnwrap(), otherNameResult._unsafeUnwrap());
    if (!table || !otherTable) return;

    const specResult = table
      .specs()
      .orGroup((b) => b.byName(nameResult._unsafeUnwrap()).byName(otherNameResult._unsafeUnwrap()))
      .build();
    specResult._unsafeUnwrap();

    expect(specResult._unsafeUnwrap().isSatisfiedBy(table)).toBe(true);
    expect(specResult._unsafeUnwrap().isSatisfiedBy(otherTable)).toBe(true);
  });

  it('supports not specs', () => {
    const baseIdResult = BaseId.create(`bse${'f'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const otherNameResult = TableName.create('Tasks');
    [baseIdResult, nameResult, otherNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();
    otherNameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    const otherTable = buildTable(baseIdResult._unsafeUnwrap(), otherNameResult._unsafeUnwrap());
    if (!table || !otherTable) return;

    const specResult = table
      .specs()
      .not((b) => b.byName(nameResult._unsafeUnwrap()))
      .build();
    specResult._unsafeUnwrap();

    expect(specResult._unsafeUnwrap().isSatisfiedBy(table)).toBe(false);
    expect(specResult._unsafeUnwrap().isSatisfiedBy(otherTable)).toBe(true);
  });

  it('supports name like specs', () => {
    const baseIdResult = BaseId.create(`bse${'g'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const otherNameResult = TableName.create('Tasks');
    const queryNameResult = TableName.create('Pro');
    [baseIdResult, nameResult, otherNameResult, queryNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();
    otherNameResult._unsafeUnwrap();
    queryNameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    const otherTable = buildTable(baseIdResult._unsafeUnwrap(), otherNameResult._unsafeUnwrap());
    if (!table || !otherTable) return;

    const specResult = table.specs().byNameLike(queryNameResult._unsafeUnwrap()).build();
    specResult._unsafeUnwrap();

    expect(specResult._unsafeUnwrap().isSatisfiedBy(table)).toBe(true);
    expect(specResult._unsafeUnwrap().isSatisfiedBy(otherTable)).toBe(false);
  });

  it('supports id list specs', () => {
    const baseIdResult = BaseId.create(`bse${'h'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const otherNameResult = TableName.create('Tasks');
    [baseIdResult, nameResult, otherNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();
    otherNameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    const otherTable = buildTable(baseIdResult._unsafeUnwrap(), otherNameResult._unsafeUnwrap());
    if (!table || !otherTable) return;

    const specResult = table.specs().withoutBaseId().byIds([table.id()]).build();
    specResult._unsafeUnwrap();

    expect(specResult._unsafeUnwrap().isSatisfiedBy(table)).toBe(true);
    expect(specResult._unsafeUnwrap().isSatisfiedBy(otherTable)).toBe(false);
  });
});
