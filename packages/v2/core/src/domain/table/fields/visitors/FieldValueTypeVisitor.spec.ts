import { describe, expect, it } from 'vitest';

import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { FieldValueTypeVisitor } from './FieldValueTypeVisitor';

const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('FieldValueTypeVisitor', () => {
  it('returns multiplicity based on link relationship', () => {
    const foreignTableIdResult = createTableId('a');
    const lookupFieldIdResult = createFieldId('b');
    const linkFieldIdResult = createFieldId('c');
    const linkFieldNameResult = FieldName.create('Link');
    expect(
      [foreignTableIdResult, lookupFieldIdResult, linkFieldIdResult, linkFieldNameResult].every(
        (r) => r.isOk()
      )
    ).toBe(true);
    if (
      foreignTableIdResult.isErr() ||
      lookupFieldIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const buildLinkField = (relationship: string) =>
      LinkFieldConfig.create({
        relationship,
        foreignTableId: foreignTableIdResult.value.toString(),
        lookupFieldId: lookupFieldIdResult.value.toString(),
      }).andThen((config) =>
        LinkField.create({
          id: linkFieldIdResult.value,
          name: linkFieldNameResult.value,
          config,
        })
      );

    const manyMany = buildLinkField('manyMany');
    const manyOne = buildLinkField('manyOne');
    expect([manyMany, manyOne].every((r) => r.isOk())).toBe(true);
    if (manyMany.isErr() || manyOne.isErr()) return;

    const visitor = new FieldValueTypeVisitor();
    const manyManyValue = manyMany.value.accept(visitor);
    const manyOneValue = manyOne.value.accept(visitor);
    expect([manyManyValue, manyOneValue].every((r) => r.isOk())).toBe(true);
    if (manyManyValue.isErr() || manyOneValue.isErr()) return;

    expect(manyManyValue.value.cellValueType.toString()).toBe('string');
    expect(manyManyValue.value.isMultipleCellValue.toBoolean()).toBe(true);

    expect(manyOneValue.value.cellValueType.toString()).toBe('string');
    expect(manyOneValue.value.isMultipleCellValue.toBoolean()).toBe(false);
  });
});
