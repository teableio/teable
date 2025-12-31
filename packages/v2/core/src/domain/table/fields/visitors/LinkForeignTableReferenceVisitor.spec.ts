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
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    foreignTableIdResult._unsafeUnwrap();
    otherForeignTableIdResult._unsafeUnwrap();
    lookupFieldIdResult._unsafeUnwrap();
    linkFieldIdResult._unsafeUnwrap();
    linkFieldNameResult._unsafeUnwrap();
    otherLinkFieldIdResult._unsafeUnwrap();
    otherLinkFieldNameResult._unsafeUnwrap();
    duplicateLinkFieldIdResult._unsafeUnwrap();

    const configResult = LinkFieldConfig.create({
      baseId: baseIdResult._unsafeUnwrap().toString(),
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
    });
    const duplicateConfigResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
    });
    const otherConfigResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: otherForeignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
    });
    [configResult, duplicateConfigResult, otherConfigResult].forEach((r) => r._unsafeUnwrap());
    configResult._unsafeUnwrap();
    duplicateConfigResult._unsafeUnwrap();
    otherConfigResult._unsafeUnwrap();

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
    });
    const duplicateFieldResult = LinkField.create({
      id: duplicateLinkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: duplicateConfigResult._unsafeUnwrap(),
    });
    const otherLinkFieldResult = LinkField.create({
      id: otherLinkFieldIdResult._unsafeUnwrap(),
      name: otherLinkFieldNameResult._unsafeUnwrap(),
      config: otherConfigResult._unsafeUnwrap(),
    });
    [linkFieldResult, duplicateFieldResult, otherLinkFieldResult].forEach((r) => r._unsafeUnwrap());
    linkFieldResult._unsafeUnwrap();
    duplicateFieldResult._unsafeUnwrap();
    otherLinkFieldResult._unsafeUnwrap();

    const visitor = new LinkForeignTableReferenceVisitor();
    const result = visitor.collect([
      linkFieldResult._unsafeUnwrap(),
      duplicateFieldResult._unsafeUnwrap(),
      otherLinkFieldResult._unsafeUnwrap(),
    ]);
    const references = result._unsafeUnwrap();
    expect(references).toHaveLength(2);

    const crossBase = references.find((ref) =>
      ref.foreignTableId.equals(foreignTableIdResult._unsafeUnwrap())
    );
    expect(crossBase).toBeDefined();
    if (!crossBase) return;
    expect(crossBase.baseId?.equals(baseIdResult._unsafeUnwrap())).toBe(true);
  });
});
