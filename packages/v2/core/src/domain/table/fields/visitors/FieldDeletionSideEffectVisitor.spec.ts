import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { ForeignTable } from '../../ForeignTable';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';
import { createNewLinkField } from '../FieldFactory';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import type { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { FieldDeletionSideEffectVisitor } from './FieldDeletionSideEffectVisitor';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

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

describe('FieldDeletionSideEffectVisitor', () => {
  it('removes symmetric link fields for foreign tables', () => {
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
    const linkField = linkFieldResult._unsafeUnwrap() as LinkField;

    const symmetricFieldResult = linkField.buildSymmetricField({
      foreignTable: ForeignTable.from(foreignTable),
      hostTable,
    });
    const symmetricField = symmetricFieldResult._unsafeUnwrap();

    const foreignUpdatedResult = foreignTable.update((mutator) =>
      mutator.addField(symmetricField, { foreignTables: [hostTable] })
    );
    foreignUpdatedResult._unsafeUnwrap();
    const foreignUpdated = foreignUpdatedResult._unsafeUnwrap().table;

    const sideEffectsResult = FieldDeletionSideEffectVisitor.collect([linkField], {
      table: hostTable,
      foreignTables: [foreignUpdated],
    });
    sideEffectsResult._unsafeUnwrap();

    expect(sideEffectsResult._unsafeUnwrap()).toHaveLength(1);

    const [effect] = sideEffectsResult._unsafeUnwrap();
    const mutateResult = effect.mutateSpec.mutate(foreignUpdated);
    mutateResult._unsafeUnwrap();

    const updated = mutateResult._unsafeUnwrap();
    expect(updated.getFields().some((field) => field.id().equals(symmetricField.id()))).toBe(false);
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

    const sideEffectsResult = FieldDeletionSideEffectVisitor.collect(
      [linkFieldResult._unsafeUnwrap()],
      {
        table: hostTable,
        foreignTables: [foreignTable],
      }
    );
    sideEffectsResult._unsafeUnwrap();

    expect(sideEffectsResult._unsafeUnwrap()).toHaveLength(0);
  });
});
