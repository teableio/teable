import { expect, describe, it } from 'vitest';

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
    expect(foreignTableIdResult.isOk()).toBe(true);
    expect(lookupFieldIdResult.isOk()).toBe(true);
    expect(linkFieldIdResult.isOk()).toBe(true);
    expect(linkFieldNameResult.isOk()).toBe(true);

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
    expect(linkField.accept(visitor).isOk()).toBe(true);
  });
});
