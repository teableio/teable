import { describe, it } from 'vitest';

import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { NoopFieldVisitor } from './NoopFieldVisitor';

const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('NoopFieldVisitor', () => {
  it('accepts link fields', () => {
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

    const configResult = LinkFieldConfig.create({
      relationship: 'oneOne',
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
    });
    const config = configResult._unsafeUnwrap();
    const linkField = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config,
    })._unsafeUnwrap();

    const visitor = new NoopFieldVisitor();
    linkField.accept(visitor)._unsafeUnwrap();
  });
});
