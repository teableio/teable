import { describe, expect, it } from 'vitest';

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

    const configResult = LinkFieldConfig.create({
      relationship: 'oneOne',
      foreignTableId: foreignTableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult.value,
      name: linkFieldNameResult.value,
      config: configResult.value,
    });
    expect(linkFieldResult.isOk()).toBe(true);
    if (linkFieldResult.isErr()) return;

    const visitor = new NoopFieldVisitor();
    const result = linkFieldResult.value.accept(visitor);
    expect(result.isOk()).toBe(true);
  });
});
