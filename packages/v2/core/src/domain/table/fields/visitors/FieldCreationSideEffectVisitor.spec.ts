import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';
import { Field } from '../Field';
import { createNewLinkField } from '../FieldFactory';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import type { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { FieldCreationSideEffectVisitor } from './FieldCreationSideEffectVisitor';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);
const buildFieldSpec = (
  build: (builder: ReturnType<typeof Field.specs>) => ReturnType<typeof Field.specs>
) => build(Field.specs()).build()._unsafeUnwrap();

const buildTable = (params: {
  baseId: BaseId;
  tableId: TableId;
  tableName: string;
  primaryFieldId: FieldId;
  primaryFieldName: string;
}) => {
  const nameResult = TableName.create(params.tableName);
  const primaryNameResult = FieldName.create(params.primaryFieldName);
  [nameResult, primaryNameResult].forEach((r) => r._unsafeUnwrap());
  const builder = Table.builder()
    .withId(params.tableId)
    .withBaseId(params.baseId)
    .withName(nameResult._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(params.primaryFieldId)
    .withName(primaryNameResult._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('FieldCreationSideEffectVisitor', () => {
  it('creates symmetric link fields for foreign tables', () => {
    const baseIdResult = createBaseId('a');
    const hostTableIdResult = createTableId('b');
    const foreignTableIdResult = createTableId('c');
    const hostPrimaryIdResult = createFieldId('d');
    const foreignPrimaryIdResult = createFieldId('e');
    const linkFieldIdResult = createFieldId('f');
    const linkFieldNameResult = FieldName.create('Link');

    [
      baseIdResult,
      hostTableIdResult,
      foreignTableIdResult,
      hostPrimaryIdResult,
      foreignPrimaryIdResult,
      linkFieldIdResult,
      linkFieldNameResult,
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    hostTableIdResult._unsafeUnwrap();
    foreignTableIdResult._unsafeUnwrap();
    hostPrimaryIdResult._unsafeUnwrap();
    foreignPrimaryIdResult._unsafeUnwrap();
    linkFieldIdResult._unsafeUnwrap();
    linkFieldNameResult._unsafeUnwrap();

    const baseId = baseIdResult._unsafeUnwrap();
    const hostTable = buildTable({
      baseId,
      tableId: hostTableIdResult._unsafeUnwrap(),
      tableName: 'Host',
      primaryFieldId: hostPrimaryIdResult._unsafeUnwrap(),
      primaryFieldName: 'Host Name',
    });
    const foreignTable = buildTable({
      baseId,
      tableId: foreignTableIdResult._unsafeUnwrap(),
      tableName: 'Foreign',
      primaryFieldId: foreignPrimaryIdResult._unsafeUnwrap(),
      primaryFieldName: 'Foreign Name',
    });

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: foreignPrimaryIdResult._unsafeUnwrap().toString(),
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = createNewLinkField({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
      baseId,
      hostTableId: hostTableIdResult._unsafeUnwrap(),
    });
    linkFieldResult._unsafeUnwrap();

    const sideEffectsResult = FieldCreationSideEffectVisitor.collect(
      [linkFieldResult._unsafeUnwrap()],
      {
        table: hostTable,
        foreignTables: [foreignTable],
      }
    );
    sideEffectsResult._unsafeUnwrap();

    expect(sideEffectsResult._unsafeUnwrap()).toHaveLength(1);

    const [effect] = sideEffectsResult._unsafeUnwrap();
    const mutateResult = effect.mutateSpec.mutate(foreignTable);
    mutateResult._unsafeUnwrap();

    const updated = mutateResult._unsafeUnwrap();

    const symmetricField = updated.getFields(buildFieldSpec((builder) => builder.isLink()))[0] as
      | LinkField
      | undefined;
    expect(symmetricField).toBeDefined();
    if (!symmetricField) return;
    expect(symmetricField.relationship().toString()).toBe('oneMany');
    expect(symmetricField.symmetricFieldId()?.equals(linkFieldIdResult._unsafeUnwrap())).toBe(true);
  });

  it('skips one-way links', () => {
    const baseIdResult = createBaseId('g');
    const hostTableIdResult = createTableId('h');
    const foreignTableIdResult = createTableId('i');
    const hostPrimaryIdResult = createFieldId('j');
    const foreignPrimaryIdResult = createFieldId('k');
    const linkFieldIdResult = createFieldId('l');
    const linkFieldNameResult = FieldName.create('Link');

    [
      baseIdResult,
      hostTableIdResult,
      foreignTableIdResult,
      hostPrimaryIdResult,
      foreignPrimaryIdResult,
      linkFieldIdResult,
      linkFieldNameResult,
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    hostTableIdResult._unsafeUnwrap();
    foreignTableIdResult._unsafeUnwrap();
    hostPrimaryIdResult._unsafeUnwrap();
    foreignPrimaryIdResult._unsafeUnwrap();
    linkFieldIdResult._unsafeUnwrap();
    linkFieldNameResult._unsafeUnwrap();

    const baseId = baseIdResult._unsafeUnwrap();
    const hostTable = buildTable({
      baseId,
      tableId: hostTableIdResult._unsafeUnwrap(),
      tableName: 'Host',
      primaryFieldId: hostPrimaryIdResult._unsafeUnwrap(),
      primaryFieldName: 'Host Name',
    });
    const foreignTable = buildTable({
      baseId,
      tableId: foreignTableIdResult._unsafeUnwrap(),
      tableName: 'Foreign',
      primaryFieldId: foreignPrimaryIdResult._unsafeUnwrap(),
      primaryFieldName: 'Foreign Name',
    });

    const configResult = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: foreignPrimaryIdResult._unsafeUnwrap().toString(),
      isOneWay: true,
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = createNewLinkField({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
      baseId,
      hostTableId: hostTableIdResult._unsafeUnwrap(),
    });
    linkFieldResult._unsafeUnwrap();

    const sideEffectsResult = FieldCreationSideEffectVisitor.collect(
      [linkFieldResult._unsafeUnwrap()],
      {
        table: hostTable,
        foreignTables: [foreignTable],
      }
    );
    sideEffectsResult._unsafeUnwrap();

    expect(sideEffectsResult._unsafeUnwrap()).toHaveLength(0);
  });

  it('supports self-referencing links', () => {
    const baseIdResult = createBaseId('m');
    const tableIdResult = createTableId('n');
    const primaryIdResult = createFieldId('o');
    const linkFieldIdResult = createFieldId('p');
    const linkFieldNameResult = FieldName.create('Link');

    baseIdResult._unsafeUnwrap();
    tableIdResult._unsafeUnwrap();
    primaryIdResult._unsafeUnwrap();
    linkFieldIdResult._unsafeUnwrap();
    linkFieldNameResult._unsafeUnwrap();

    const baseId = baseIdResult._unsafeUnwrap();
    const table = buildTable({
      baseId,
      tableId: tableIdResult._unsafeUnwrap(),
      tableName: 'Self',
      primaryFieldId: primaryIdResult._unsafeUnwrap(),
      primaryFieldName: 'Name',
    });

    const configResult = LinkFieldConfig.create({
      relationship: 'manyMany',
      foreignTableId: tableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: primaryIdResult._unsafeUnwrap().toString(),
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = createNewLinkField({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
      baseId,
      hostTableId: tableIdResult._unsafeUnwrap(),
    });
    linkFieldResult._unsafeUnwrap();

    const sideEffectsResult = FieldCreationSideEffectVisitor.collect(
      [linkFieldResult._unsafeUnwrap()],
      {
        table,
        foreignTables: [table],
      }
    );
    sideEffectsResult._unsafeUnwrap();

    expect(sideEffectsResult._unsafeUnwrap()).toHaveLength(1);

    const [effect] = sideEffectsResult._unsafeUnwrap();
    expect(effect.foreignTable.id().equals(tableIdResult._unsafeUnwrap())).toBe(true);
    const updatedResult = effect.mutateSpec.mutate(table);
    updatedResult._unsafeUnwrap();

    expect(
      updatedResult._unsafeUnwrap().getFields(buildFieldSpec((builder) => builder.isLink()))
    ).toHaveLength(1);
  });

  it('errors when foreign table is missing', () => {
    const baseIdResult = createBaseId('q');
    const hostTableIdResult = createTableId('r');
    const foreignTableIdResult = createTableId('s');
    const hostPrimaryIdResult = createFieldId('t');
    const foreignPrimaryIdResult = createFieldId('u');
    const linkFieldIdResult = createFieldId('v');
    const linkFieldNameResult = FieldName.create('Link');

    [
      baseIdResult,
      hostTableIdResult,
      foreignTableIdResult,
      hostPrimaryIdResult,
      foreignPrimaryIdResult,
      linkFieldIdResult,
      linkFieldNameResult,
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    hostTableIdResult._unsafeUnwrap();
    foreignTableIdResult._unsafeUnwrap();
    hostPrimaryIdResult._unsafeUnwrap();
    foreignPrimaryIdResult._unsafeUnwrap();
    linkFieldIdResult._unsafeUnwrap();
    linkFieldNameResult._unsafeUnwrap();

    const baseId = baseIdResult._unsafeUnwrap();
    const hostTable = buildTable({
      baseId,
      tableId: hostTableIdResult._unsafeUnwrap(),
      tableName: 'Host',
      primaryFieldId: hostPrimaryIdResult._unsafeUnwrap(),
      primaryFieldName: 'Host Name',
    });

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: foreignPrimaryIdResult._unsafeUnwrap().toString(),
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = createNewLinkField({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
      baseId,
      hostTableId: hostTableIdResult._unsafeUnwrap(),
    });
    linkFieldResult._unsafeUnwrap();

    const sideEffectsResult = FieldCreationSideEffectVisitor.collect(
      [linkFieldResult._unsafeUnwrap()],
      {
        table: hostTable,
        foreignTables: [],
      }
    );
    sideEffectsResult._unsafeUnwrapErr();
  });
});
