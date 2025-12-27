import { describe, expect, it } from 'vitest';

import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { FieldFormVisibilityVisitor } from './FieldFormVisibilityVisitor';

const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('FieldFormVisibilityVisitor', () => {
  it('marks link fields as visible', () => {
    const foreignTableIdResult = createTableId('a');
    const lookupFieldIdResult = createFieldId('b');
    const linkFieldIdResult = createFieldId('c');
    const linkFieldNameResult = FieldName.create('Link');

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
    });
    const config = configResult._unsafeUnwrap();
    const linkField = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config,
    })._unsafeUnwrap();

    const visitor = new FieldFormVisibilityVisitor();
    const visibility = linkField.accept(visitor)._unsafeUnwrap();

    expect(visibility).toBe(true);
  });
});
