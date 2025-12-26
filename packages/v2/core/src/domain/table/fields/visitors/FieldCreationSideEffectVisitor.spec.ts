import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';
import { createNewLinkField } from '../FieldFactory';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import type { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { FieldCreationSideEffectVisitor } from './FieldCreationSideEffectVisitor';

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
  expect([nameResult, primaryNameResult].every((r) => r.isOk())).toBe(true);
  if (nameResult.isErr() || primaryNameResult.isErr()) {
    throw new Error('Invalid table setup');
  }
  const builder = Table.builder()
    .withId(params.tableId)
    .withBaseId(params.baseId)
    .withName(nameResult.value);
  builder
    .field()
    .singleLineText()
    .withId(params.primaryFieldId)
    .withName(primaryNameResult.value)
    .primary()
    .done();
  builder.view().defaultGrid().done();
  const result = builder.build();
  expect(result.isOk()).toBe(true);
  if (result.isErr()) throw new Error('Table build failed');
  return result.value;
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

    expect(
      [
        baseIdResult,
        hostTableIdResult,
        foreignTableIdResult,
        hostPrimaryIdResult,
        foreignPrimaryIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      hostTableIdResult.isErr() ||
      foreignTableIdResult.isErr() ||
      hostPrimaryIdResult.isErr() ||
      foreignPrimaryIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const baseId = baseIdResult.value;
    const hostTable = buildTable({
      baseId,
      tableId: hostTableIdResult.value,
      tableName: 'Host',
      primaryFieldId: hostPrimaryIdResult.value,
      primaryFieldName: 'Host Name',
    });
    const foreignTable = buildTable({
      baseId,
      tableId: foreignTableIdResult.value,
      tableName: 'Foreign',
      primaryFieldId: foreignPrimaryIdResult.value,
      primaryFieldName: 'Foreign Name',
    });

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult.value.toString(),
      lookupFieldId: foreignPrimaryIdResult.value.toString(),
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const linkFieldResult = createNewLinkField({
      id: linkFieldIdResult.value,
      name: linkFieldNameResult.value,
      config: configResult.value,
      baseId,
      hostTableId: hostTableIdResult.value,
    });
    expect(linkFieldResult.isOk()).toBe(true);
    if (linkFieldResult.isErr()) return;

    const sideEffectsResult = FieldCreationSideEffectVisitor.collect([linkFieldResult.value], {
      table: hostTable,
      foreignTables: [foreignTable],
    });
    expect(sideEffectsResult.isOk()).toBe(true);
    if (sideEffectsResult.isErr()) return;
    expect(sideEffectsResult.value).toHaveLength(1);

    const [effect] = sideEffectsResult.value;
    const mutateResult = effect.mutateSpec.mutate(foreignTable);
    expect(mutateResult.isOk()).toBe(true);
    if (mutateResult.isErr()) return;
    const updated = mutateResult.value;

    const symmetricField = updated.fields().find((f) => f.type().toString() === 'link') as
      | LinkField
      | undefined;
    expect(symmetricField).toBeDefined();
    if (!symmetricField) return;
    expect(symmetricField.relationship().toString()).toBe('oneMany');
    expect(symmetricField.symmetricFieldId()?.equals(linkFieldIdResult.value)).toBe(true);
  });

  it('skips one-way links', () => {
    const baseIdResult = createBaseId('g');
    const hostTableIdResult = createTableId('h');
    const foreignTableIdResult = createTableId('i');
    const hostPrimaryIdResult = createFieldId('j');
    const foreignPrimaryIdResult = createFieldId('k');
    const linkFieldIdResult = createFieldId('l');
    const linkFieldNameResult = FieldName.create('Link');

    expect(
      [
        baseIdResult,
        hostTableIdResult,
        foreignTableIdResult,
        hostPrimaryIdResult,
        foreignPrimaryIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      hostTableIdResult.isErr() ||
      foreignTableIdResult.isErr() ||
      hostPrimaryIdResult.isErr() ||
      foreignPrimaryIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const baseId = baseIdResult.value;
    const hostTable = buildTable({
      baseId,
      tableId: hostTableIdResult.value,
      tableName: 'Host',
      primaryFieldId: hostPrimaryIdResult.value,
      primaryFieldName: 'Host Name',
    });
    const foreignTable = buildTable({
      baseId,
      tableId: foreignTableIdResult.value,
      tableName: 'Foreign',
      primaryFieldId: foreignPrimaryIdResult.value,
      primaryFieldName: 'Foreign Name',
    });

    const configResult = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTableIdResult.value.toString(),
      lookupFieldId: foreignPrimaryIdResult.value.toString(),
      isOneWay: true,
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const linkFieldResult = createNewLinkField({
      id: linkFieldIdResult.value,
      name: linkFieldNameResult.value,
      config: configResult.value,
      baseId,
      hostTableId: hostTableIdResult.value,
    });
    expect(linkFieldResult.isOk()).toBe(true);
    if (linkFieldResult.isErr()) return;

    const sideEffectsResult = FieldCreationSideEffectVisitor.collect([linkFieldResult.value], {
      table: hostTable,
      foreignTables: [foreignTable],
    });
    expect(sideEffectsResult.isOk()).toBe(true);
    if (sideEffectsResult.isErr()) return;
    expect(sideEffectsResult.value).toHaveLength(0);
  });

  it('supports self-referencing links', () => {
    const baseIdResult = createBaseId('m');
    const tableIdResult = createTableId('n');
    const primaryIdResult = createFieldId('o');
    const linkFieldIdResult = createFieldId('p');
    const linkFieldNameResult = FieldName.create('Link');

    expect(
      [baseIdResult, tableIdResult, primaryIdResult, linkFieldIdResult, linkFieldNameResult].every(
        (r) => r.isOk()
      )
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableIdResult.isErr() ||
      primaryIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const baseId = baseIdResult.value;
    const table = buildTable({
      baseId,
      tableId: tableIdResult.value,
      tableName: 'Self',
      primaryFieldId: primaryIdResult.value,
      primaryFieldName: 'Name',
    });

    const configResult = LinkFieldConfig.create({
      relationship: 'manyMany',
      foreignTableId: tableIdResult.value.toString(),
      lookupFieldId: primaryIdResult.value.toString(),
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const linkFieldResult = createNewLinkField({
      id: linkFieldIdResult.value,
      name: linkFieldNameResult.value,
      config: configResult.value,
      baseId,
      hostTableId: tableIdResult.value,
    });
    expect(linkFieldResult.isOk()).toBe(true);
    if (linkFieldResult.isErr()) return;

    const sideEffectsResult = FieldCreationSideEffectVisitor.collect([linkFieldResult.value], {
      table,
      foreignTables: [table],
    });
    expect(sideEffectsResult.isOk()).toBe(true);
    if (sideEffectsResult.isErr()) return;
    expect(sideEffectsResult.value).toHaveLength(1);

    const [effect] = sideEffectsResult.value;
    expect(effect.foreignTableId.equals(tableIdResult.value)).toBe(true);
    const updatedResult = effect.mutateSpec.mutate(table);
    expect(updatedResult.isOk()).toBe(true);
    if (updatedResult.isErr()) return;
    expect(updatedResult.value.fields().filter((f) => f.type().toString() === 'link')).toHaveLength(
      1
    );
  });

  it('errors when foreign table is missing', () => {
    const baseIdResult = createBaseId('q');
    const hostTableIdResult = createTableId('r');
    const foreignTableIdResult = createTableId('s');
    const hostPrimaryIdResult = createFieldId('t');
    const foreignPrimaryIdResult = createFieldId('u');
    const linkFieldIdResult = createFieldId('v');
    const linkFieldNameResult = FieldName.create('Link');

    expect(
      [
        baseIdResult,
        hostTableIdResult,
        foreignTableIdResult,
        hostPrimaryIdResult,
        foreignPrimaryIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      hostTableIdResult.isErr() ||
      foreignTableIdResult.isErr() ||
      hostPrimaryIdResult.isErr() ||
      foreignPrimaryIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const baseId = baseIdResult.value;
    const hostTable = buildTable({
      baseId,
      tableId: hostTableIdResult.value,
      tableName: 'Host',
      primaryFieldId: hostPrimaryIdResult.value,
      primaryFieldName: 'Host Name',
    });

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult.value.toString(),
      lookupFieldId: foreignPrimaryIdResult.value.toString(),
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const linkFieldResult = createNewLinkField({
      id: linkFieldIdResult.value,
      name: linkFieldNameResult.value,
      config: configResult.value,
      baseId,
      hostTableId: hostTableIdResult.value,
    });
    expect(linkFieldResult.isOk()).toBe(true);
    if (linkFieldResult.isErr()) return;

    const sideEffectsResult = FieldCreationSideEffectVisitor.collect([linkFieldResult.value], {
      table: hostTable,
      foreignTables: [],
    });
    expect(sideEffectsResult.isErr()).toBe(true);
  });
});
