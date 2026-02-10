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
    [foreignTableIdResult, lookupFieldIdResult, linkFieldIdResult, linkFieldNameResult].forEach(
      (r) => r._unsafeUnwrap()
    );
    foreignTableIdResult._unsafeUnwrap();
    lookupFieldIdResult._unsafeUnwrap();
    linkFieldIdResult._unsafeUnwrap();
    linkFieldNameResult._unsafeUnwrap();

    const buildLinkField = (relationship: string) =>
      LinkFieldConfig.create({
        relationship,
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      }).andThen((config) =>
        LinkField.create({
          id: linkFieldIdResult._unsafeUnwrap(),
          name: linkFieldNameResult._unsafeUnwrap(),
          config,
        })
      );

    const manyMany = buildLinkField('manyMany');
    const manyOne = buildLinkField('manyOne');
    const manyManyField = manyMany._unsafeUnwrap();
    const manyOneField = manyOne._unsafeUnwrap();

    const visitor = new FieldValueTypeVisitor();
    const manyManyValue = manyManyField.accept(visitor)._unsafeUnwrap();
    const manyOneValue = manyOneField.accept(visitor)._unsafeUnwrap();

    expect(manyManyValue.cellValueType.toString()).toBe('string');
    expect(manyManyValue.isMultipleCellValue.toBoolean()).toBe(true);

    expect(manyOneValue.cellValueType.toString()).toBe('string');
    expect(manyOneValue.isMultipleCellValue.toBoolean()).toBe(false);
  });
});
