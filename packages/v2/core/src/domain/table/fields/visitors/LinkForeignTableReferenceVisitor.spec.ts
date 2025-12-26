import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { TableId } from '../../TableId';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { LinkForeignTableReferenceVisitor } from './LinkForeignTableReferenceVisitor';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('LinkForeignTableReferenceVisitor', () => {
  it('collects unique references and includes baseId', () => {
    const baseIdResult = createBaseId('a');
    const foreignTableIdResult = createTableId('c');
    const otherForeignTableIdResult = createTableId('d');
    const lookupFieldIdResult = createFieldId('e');
    const linkFieldIdResult = createFieldId('f');
    const linkFieldNameResult = FieldName.create('Link');
    const otherLinkFieldIdResult = createFieldId('g');
    const otherLinkFieldNameResult = FieldName.create('Link 2');
    const duplicateLinkFieldIdResult = createFieldId('h');

    expect(
      [
        baseIdResult,
        foreignTableIdResult,
        otherForeignTableIdResult,
        lookupFieldIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
        otherLinkFieldIdResult,
        otherLinkFieldNameResult,
        duplicateLinkFieldIdResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      foreignTableIdResult.isErr() ||
      otherForeignTableIdResult.isErr() ||
      lookupFieldIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr() ||
      otherLinkFieldIdResult.isErr() ||
      otherLinkFieldNameResult.isErr() ||
      duplicateLinkFieldIdResult.isErr()
    )
      return;

    const configResult = LinkFieldConfig.create({
      baseId: baseIdResult.value.toString(),
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
    });
    const duplicateConfigResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
    });
    const otherConfigResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: otherForeignTableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
    });
    expect([configResult, duplicateConfigResult, otherConfigResult].every((r) => r.isOk())).toBe(
      true
    );
    if (configResult.isErr() || duplicateConfigResult.isErr() || otherConfigResult.isErr()) return;

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult.value,
      name: linkFieldNameResult.value,
      config: configResult.value,
    });
    const duplicateFieldResult = LinkField.create({
      id: duplicateLinkFieldIdResult.value,
      name: linkFieldNameResult.value,
      config: duplicateConfigResult.value,
    });
    const otherLinkFieldResult = LinkField.create({
      id: otherLinkFieldIdResult.value,
      name: otherLinkFieldNameResult.value,
      config: otherConfigResult.value,
    });
    expect(
      [linkFieldResult, duplicateFieldResult, otherLinkFieldResult].every((r) => r.isOk())
    ).toBe(true);
    if (linkFieldResult.isErr() || duplicateFieldResult.isErr() || otherLinkFieldResult.isErr())
      return;

    const visitor = new LinkForeignTableReferenceVisitor();
    const result = visitor.collect([
      linkFieldResult.value,
      duplicateFieldResult.value,
      otherLinkFieldResult.value,
    ]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toHaveLength(2);

    const crossBase = result.value.find((ref) =>
      ref.foreignTableId.equals(foreignTableIdResult.value)
    );
    expect(crossBase).toBeDefined();
    if (!crossBase) return;
    expect(crossBase.baseId?.equals(baseIdResult.value)).toBe(true);
  });
});
