import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { ForeignTable } from '../../ForeignTable';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';
import { ViewId } from '../../views/ViewId';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { LinkField } from './LinkField';
import { LinkFieldConfig } from './LinkFieldConfig';
import { LinkFieldMeta } from './LinkFieldMeta';
import { LinkRelationship } from './LinkRelationship';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('LinkField', () => {
  it('resolves lookup field from branded foreign table', () => {
    const baseIdResult = createBaseId('a');
    const tableIdResult = createTableId('b');
    const tableNameResult = TableName.create('Foreign');
    const lookupFieldIdResult = createFieldId('c');
    const lookupFieldNameResult = FieldName.create('Lookup');
    const linkFieldIdResult = createFieldId('d');
    const linkFieldNameResult = FieldName.create('Link');

    expect(
      [
        baseIdResult,
        tableIdResult,
        tableNameResult,
        lookupFieldIdResult,
        lookupFieldNameResult,
        linkFieldIdResult,
        linkFieldNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableIdResult.isErr() ||
      tableNameResult.isErr() ||
      lookupFieldIdResult.isErr() ||
      lookupFieldNameResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const tableBuilder = Table.builder()
      .withId(tableIdResult.value)
      .withBaseId(baseIdResult.value)
      .withName(tableNameResult.value);
    tableBuilder
      .field()
      .singleLineText()
      .withId(lookupFieldIdResult.value)
      .withName(lookupFieldNameResult.value)
      .done();
    tableBuilder.view().defaultGrid().done();
    const foreignTableResult = tableBuilder.build();
    expect(foreignTableResult.isOk()).toBe(true);
    if (foreignTableResult.isErr()) return;
    const foreignTable = ForeignTable.from(foreignTableResult.value);

    const configResult = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: tableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
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

    const lookupResult = linkFieldResult.value.lookupField(foreignTable);
    expect(lookupResult.isOk()).toBe(true);
    if (lookupResult.isErr()) return;
    expect(lookupResult.value.id().equals(lookupFieldIdResult.value)).toBe(true);
  });

  it('rejects foreign table mismatch', () => {
    const baseIdResult = createBaseId('e');
    const tableIdResult = createTableId('f');
    const tableNameResult = TableName.create('Foreign');
    const lookupFieldIdResult = createFieldId('g');
    const lookupFieldNameResult = FieldName.create('Lookup');
    const linkFieldIdResult = createFieldId('h');
    const linkFieldNameResult = FieldName.create('Link');
    const otherTableIdResult = createTableId('i');

    expect(
      [
        baseIdResult,
        tableIdResult,
        tableNameResult,
        lookupFieldIdResult,
        lookupFieldNameResult,
        linkFieldIdResult,
        linkFieldNameResult,
        otherTableIdResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableIdResult.isErr() ||
      tableNameResult.isErr() ||
      lookupFieldIdResult.isErr() ||
      lookupFieldNameResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr() ||
      otherTableIdResult.isErr()
    )
      return;

    const tableBuilder = Table.builder()
      .withId(tableIdResult.value)
      .withBaseId(baseIdResult.value)
      .withName(tableNameResult.value);
    tableBuilder
      .field()
      .singleLineText()
      .withId(lookupFieldIdResult.value)
      .withName(lookupFieldNameResult.value)
      .done();
    tableBuilder.view().defaultGrid().done();
    const foreignTableResult = tableBuilder.build();
    expect(foreignTableResult.isOk()).toBe(true);
    if (foreignTableResult.isErr()) return;
    const foreignTable = ForeignTable.from(foreignTableResult.value);

    const configResult = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: otherTableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
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

    const lookupResult = linkFieldResult.value.lookupField(foreignTable);
    expect(lookupResult.isErr()).toBe(true);
  });

  it('resolves symmetric and visible fields from foreign table', () => {
    const baseIdResult = createBaseId('p');
    const tableIdResult = createTableId('q');
    const tableNameResult = TableName.create('Foreign');
    const lookupFieldIdResult = createFieldId('r');
    const lookupFieldNameResult = FieldName.create('Lookup');
    const symmetricFieldIdResult = createFieldId('s');
    const symmetricFieldNameResult = FieldName.create('Symmetric');
    const visibleFieldIdResult = createFieldId('t');
    const visibleFieldNameResult = FieldName.create('Visible');
    const linkFieldIdResult = createFieldId('u');
    const linkFieldNameResult = FieldName.create('Link');

    expect(
      [
        baseIdResult,
        tableIdResult,
        tableNameResult,
        lookupFieldIdResult,
        lookupFieldNameResult,
        symmetricFieldIdResult,
        symmetricFieldNameResult,
        visibleFieldIdResult,
        visibleFieldNameResult,
        linkFieldIdResult,
        linkFieldNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableIdResult.isErr() ||
      tableNameResult.isErr() ||
      lookupFieldIdResult.isErr() ||
      lookupFieldNameResult.isErr() ||
      symmetricFieldIdResult.isErr() ||
      symmetricFieldNameResult.isErr() ||
      visibleFieldIdResult.isErr() ||
      visibleFieldNameResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const tableBuilder = Table.builder()
      .withId(tableIdResult.value)
      .withBaseId(baseIdResult.value)
      .withName(tableNameResult.value);
    tableBuilder
      .field()
      .singleLineText()
      .withId(lookupFieldIdResult.value)
      .withName(lookupFieldNameResult.value)
      .done();
    tableBuilder
      .field()
      .singleLineText()
      .withId(symmetricFieldIdResult.value)
      .withName(symmetricFieldNameResult.value)
      .done();
    tableBuilder
      .field()
      .singleLineText()
      .withId(visibleFieldIdResult.value)
      .withName(visibleFieldNameResult.value)
      .done();
    tableBuilder.view().defaultGrid().done();
    const foreignTableResult = tableBuilder.build();
    expect(foreignTableResult.isOk()).toBe(true);
    if (foreignTableResult.isErr()) return;
    const foreignTable = ForeignTable.from(foreignTableResult.value);

    const configResult = LinkFieldConfig.create({
      relationship: LinkRelationship.oneMany().toString(),
      foreignTableId: tableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
      symmetricFieldId: symmetricFieldIdResult.value.toString(),
      visibleFieldIds: [
        lookupFieldIdResult.value.toString(),
        visibleFieldIdResult.value.toString(),
      ],
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
    const linkField = linkFieldResult.value;

    const symmetricFieldResult = linkField.symmetricField(foreignTable);
    expect(symmetricFieldResult.isOk()).toBe(true);
    if (symmetricFieldResult.isErr()) return;
    expect(symmetricFieldResult.value?.id().equals(symmetricFieldIdResult.value)).toBe(true);

    const visibleFieldsResult = linkField.visibleFields(foreignTable);
    expect(visibleFieldsResult.isOk()).toBe(true);
    if (visibleFieldsResult.isErr()) return;
    expect(visibleFieldsResult.value?.length).toBe(2);
    if (visibleFieldsResult.value) {
      expect(visibleFieldsResult.value[0].id().equals(lookupFieldIdResult.value)).toBe(true);
      expect(visibleFieldsResult.value[1].id().equals(visibleFieldIdResult.value)).toBe(true);
    }
  });

  it('exposes config and meta values', () => {
    const baseIdResult = createBaseId('j');
    const foreignTableIdResult = createTableId('k');
    const lookupFieldIdResult = createFieldId('l');
    const symmetricFieldIdResult = createFieldId('m');
    const linkFieldIdResult = createFieldId('n');
    const linkFieldNameResult = FieldName.create('Link');
    const viewIdResult = ViewId.create(`viw${'o'.repeat(16)}`);
    const metaResult = LinkFieldMeta.create({ hasOrderColumn: true });

    expect(
      [
        baseIdResult,
        foreignTableIdResult,
        lookupFieldIdResult,
        symmetricFieldIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
        viewIdResult,
        metaResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      foreignTableIdResult.isErr() ||
      lookupFieldIdResult.isErr() ||
      symmetricFieldIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr() ||
      viewIdResult.isErr() ||
      metaResult.isErr()
    )
      return;

    const configResult = LinkFieldConfig.create({
      baseId: baseIdResult.value.toString(),
      relationship: LinkRelationship.oneMany().toString(),
      foreignTableId: foreignTableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
      isOneWay: false,
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
      symmetricFieldId: symmetricFieldIdResult.value.toString(),
      filterByViewId: viewIdResult.value.toString(),
      visibleFieldIds: [
        lookupFieldIdResult.value.toString(),
        symmetricFieldIdResult.value.toString(),
      ],
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult.value,
      name: linkFieldNameResult.value,
      config: configResult.value,
      meta: metaResult.value,
    });
    expect(linkFieldResult.isOk()).toBe(true);
    if (linkFieldResult.isErr()) return;
    const linkField = linkFieldResult.value;

    expect(linkField.symmetricFieldId()?.equals(symmetricFieldIdResult.value)).toBe(true);
    expect(linkField.filterByViewId()?.equals(viewIdResult.value)).toBe(true);
    expect(linkField.isCrossBase()).toBe(true);
    expect(linkField.isMultipleValue()).toBe(true);

    const visibleFieldIds = linkField.visibleFieldIds();
    expect(visibleFieldIds?.length).toBe(2);
    if (visibleFieldIds) {
      expect(visibleFieldIds[0].equals(lookupFieldIdResult.value)).toBe(true);
      expect(visibleFieldIds[1].equals(symmetricFieldIdResult.value)).toBe(true);
    }

    const fkHostTableNameResult = linkField.fkHostTableNameString();
    expect(fkHostTableNameResult.isOk()).toBe(true);
    if (fkHostTableNameResult.isErr()) return;
    expect(fkHostTableNameResult.value).toBe('link_table');

    const selfKeyNameResult = linkField.selfKeyNameString();
    expect(selfKeyNameResult.isOk()).toBe(true);
    if (selfKeyNameResult.isErr()) return;
    expect(selfKeyNameResult.value).toBe('__id');

    const foreignKeyNameResult = linkField.foreignKeyNameString();
    expect(foreignKeyNameResult.isOk()).toBe(true);
    if (foreignKeyNameResult.isErr()) return;
    expect(foreignKeyNameResult.value).toBe('__fk_link');

    const orderColumnResult = linkField.orderColumnName();
    expect(orderColumnResult.isOk()).toBe(true);
    if (orderColumnResult.isErr()) return;
    expect(orderColumnResult.value).toBe('__id_order');

    const configDtoResult = linkField.configDto();
    expect(configDtoResult.isOk()).toBe(true);
    if (configDtoResult.isErr()) return;
    expect(configDtoResult.value.symmetricFieldId).toBe(symmetricFieldIdResult.value.toString());

    expect(linkField.metaDto()?.hasOrderColumn).toBe(true);
  });

  it('exposes db name objects', () => {
    const foreignTableIdResult = createTableId('1');
    const lookupFieldIdResult = createFieldId('2');
    const linkFieldIdResult = createFieldId('3');
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
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: foreignTableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
      fkHostTableName: 'schema.table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
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

    const linkField = linkFieldResult.value;
    expect(linkField.fkHostTableName().value()._unsafeUnwrap()).toBe('schema.table');
    expect(linkField.selfKeyName().value()._unsafeUnwrap()).toBe('__id');
    expect(linkField.foreignKeyName().value()._unsafeUnwrap()).toBe('__fk_link');
  });

  it('builds db config for each relationship', () => {
    const baseIdResult = createBaseId('v');
    const hostTableIdResult = createTableId('w');
    const foreignTableIdResult = createTableId('x');
    const lookupFieldIdResult = createFieldId('y');
    const linkFieldIdResult = createFieldId('z');
    const linkFieldNameResult = FieldName.create('Link');
    expect(
      [
        baseIdResult,
        hostTableIdResult,
        foreignTableIdResult,
        lookupFieldIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      hostTableIdResult.isErr() ||
      foreignTableIdResult.isErr() ||
      lookupFieldIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const baseId = baseIdResult.value;
    const hostTableId = hostTableIdResult.value;
    const foreignTableId = foreignTableIdResult.value;
    const lookupFieldId = lookupFieldIdResult.value;
    const linkFieldId = linkFieldIdResult.value;
    const linkFieldName = linkFieldNameResult.value;

    const buildField = (relationship: string, isOneWay?: boolean) =>
      LinkFieldConfig.create({
        relationship,
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        isOneWay,
      }).andThen((config) =>
        LinkField.create({
          id: linkFieldId,
          name: linkFieldName,
          config,
        }).andThen((field) => field.ensureDbConfig({ baseId, hostTableId }).map(() => field))
      );

    const manyMany = buildField('manyMany');
    const manyOne = buildField('manyOne');
    const oneOne = buildField('oneOne');
    const oneMany = buildField('oneMany');
    const oneManyOneWay = buildField('oneMany', true);
    expect([manyMany, manyOne, oneOne, oneMany, oneManyOneWay].every((r) => r.isOk())).toBe(true);
    if (
      manyMany.isErr() ||
      manyOne.isErr() ||
      oneOne.isErr() ||
      oneMany.isErr() ||
      oneManyOneWay.isErr()
    )
      return;

    const fkManyMany = manyMany.value.fkHostTableNameString();
    expect(fkManyMany.isOk()).toBe(true);
    if (fkManyMany.isErr()) return;
    expect(
      fkManyMany.value.startsWith(`${baseId.toString()}.junction_${linkFieldId.toString()}`)
    ).toBe(true);

    const fkManyOne = manyOne.value.fkHostTableNameString();
    const fkOneOne = oneOne.value.fkHostTableNameString();
    const fkOneMany = oneMany.value.fkHostTableNameString();
    expect([fkManyOne, fkOneOne, fkOneMany].every((r) => r.isOk())).toBe(true);
    if (fkManyOne.isErr() || fkOneOne.isErr() || fkOneMany.isErr()) return;
    expect(fkManyOne.value).toBe(`${baseId.toString()}.${hostTableId.toString()}`);
    expect(fkOneOne.value).toBe(`${baseId.toString()}.${hostTableId.toString()}`);
    expect(fkOneMany.value).toBe(`${baseId.toString()}.${foreignTableId.toString()}`);

    const fkOneManyOneWay = oneManyOneWay.value.fkHostTableNameString();
    expect(fkOneManyOneWay.isOk()).toBe(true);
    if (fkOneManyOneWay.isErr()) return;
    expect(
      fkOneManyOneWay.value.startsWith(`${baseId.toString()}.junction_${linkFieldId.toString()}`)
    ).toBe(true);
  });

  it('builds symmetric fields and swaps db config', () => {
    const baseIdResult = createBaseId('1');
    const hostTableIdResult = createTableId('2');
    const foreignTableIdResult = createTableId('3');
    const hostTableNameResult = TableName.create('Host');
    const foreignTableNameResult = TableName.create('Foreign');
    const hostPrimaryIdResult = createFieldId('4');
    const foreignPrimaryIdResult = createFieldId('5');
    const linkFieldIdResult = createFieldId('6');
    const linkFieldNameResult = FieldName.create('Link');
    const metaResult = LinkFieldMeta.create({ hasOrderColumn: true });

    expect(
      [
        baseIdResult,
        hostTableIdResult,
        foreignTableIdResult,
        hostTableNameResult,
        foreignTableNameResult,
        hostPrimaryIdResult,
        foreignPrimaryIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
        metaResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      hostTableIdResult.isErr() ||
      foreignTableIdResult.isErr() ||
      hostTableNameResult.isErr() ||
      foreignTableNameResult.isErr() ||
      hostPrimaryIdResult.isErr() ||
      foreignPrimaryIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr() ||
      metaResult.isErr()
    )
      return;

    const baseId = baseIdResult.value;
    const hostTableId = hostTableIdResult.value;
    const foreignTableId = foreignTableIdResult.value;
    const hostPrimaryId = hostPrimaryIdResult.value;
    const foreignPrimaryId = foreignPrimaryIdResult.value;
    const linkFieldId = linkFieldIdResult.value;
    const linkFieldName = linkFieldNameResult.value;
    const meta = metaResult.value;

    const hostBuilder = Table.builder()
      .withId(hostTableId)
      .withBaseId(baseId)
      .withName(hostTableNameResult.value);
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryId)
      .withName(FieldName.create('Host Name')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTableResult = hostBuilder.build();
    expect(hostTableResult.isOk()).toBe(true);
    if (hostTableResult.isErr()) return;
    const hostTable = hostTableResult.value;

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(foreignTableNameResult.value);
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTableResult = foreignBuilder.build();
    expect(foreignTableResult.isOk()).toBe(true);
    if (foreignTableResult.isErr()) return;
    const foreignTable = ForeignTable.from(foreignTableResult.value);

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      fkHostTableName: 'schema.link',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const linkFieldResult = LinkField.create({
      id: linkFieldId,
      name: linkFieldName,
      config: configResult.value,
      meta,
    });
    expect(linkFieldResult.isOk()).toBe(true);
    if (linkFieldResult.isErr()) return;

    const symmetricResult = linkFieldResult.value.buildSymmetricField({
      foreignTable,
      hostTable,
    });
    expect(symmetricResult.isOk()).toBe(true);
    if (symmetricResult.isErr()) return;

    const symmetric = symmetricResult.value;
    expect(symmetric.relationship().toString()).toBe('oneMany');
    expect(symmetric.foreignTableId().equals(hostTableId)).toBe(true);
    expect(symmetric.lookupFieldId().equals(hostPrimaryId)).toBe(true);
    expect(symmetric.symmetricFieldId()?.equals(linkFieldId)).toBe(true);
    expect(symmetric.meta()?.hasOrderColumn()).toBe(true);

    const symmetricSelfKey = symmetric.selfKeyNameString();
    const symmetricForeignKey = symmetric.foreignKeyNameString();
    expect([symmetricSelfKey, symmetricForeignKey].every((r) => r.isOk())).toBe(true);
    if (symmetricSelfKey.isErr() || symmetricForeignKey.isErr()) return;
    expect(symmetricSelfKey.value).toBe('__fk_link');
    expect(symmetricForeignKey.value).toBe('__id');
  });

  it('rejects symmetric build for one-way links', () => {
    const baseIdResult = createBaseId('7');
    const foreignTableIdResult = createTableId('8');
    const lookupFieldIdResult = createFieldId('9');
    const linkFieldIdResult = createFieldId('0');
    const linkFieldNameResult = FieldName.create('Link');

    expect(
      [
        baseIdResult,
        foreignTableIdResult,
        lookupFieldIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      foreignTableIdResult.isErr() ||
      lookupFieldIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const configResult = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTableIdResult.value.toString(),
      lookupFieldId: lookupFieldIdResult.value.toString(),
      isOneWay: true,
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

    const hostTableResult = Table.builder()
      .withBaseId(baseIdResult.value)
      .withName(TableName.create('Host')._unsafeUnwrap())
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done()
      .view()
      .defaultGrid()
      .done()
      .build();
    expect(hostTableResult.isOk()).toBe(true);
    if (hostTableResult.isErr()) return;

    const foreignTableResult = Table.builder()
      .withId(foreignTableIdResult.value)
      .withBaseId(baseIdResult.value)
      .withName(TableName.create('Foreign')._unsafeUnwrap())
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done()
      .view()
      .defaultGrid()
      .done()
      .build();
    expect(foreignTableResult.isOk()).toBe(true);
    if (foreignTableResult.isErr()) return;

    const symmetricResult = linkFieldResult.value.buildSymmetricField({
      foreignTable: ForeignTable.from(foreignTableResult.value),
      hostTable: hostTableResult.value,
    });
    expect(symmetricResult.isErr()).toBe(true);
  });

  it('returns error when symmetric name cannot be generated', () => {
    const baseIdResult = createBaseId('z');
    const tableIdResult = createTableId('y');
    const primaryFieldIdResult = createFieldId('x');
    const linkFieldIdResult = createFieldId('w');
    const linkFieldNameResult = FieldName.create('Link');
    expect(
      [
        baseIdResult,
        tableIdResult,
        primaryFieldIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      tableIdResult.isErr() ||
      primaryFieldIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const builder = Table.builder()
      .withId(tableIdResult.value)
      .withBaseId(baseIdResult.value)
      .withName(TableName.create('Host')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(primaryFieldIdResult.value)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();

    const linkBaseName = linkFieldNameResult.value.toString();
    const allNames = [
      linkBaseName,
      `${linkBaseName} (linked)`,
      ...Array.from({ length: 99 }, (_, i) => `${linkBaseName} (linked ${i + 2})`),
    ];
    for (const name of allNames) {
      const nameResult = FieldName.create(name);
      expect(nameResult.isOk()).toBe(true);
      if (nameResult.isErr()) return;
      builder.field().singleLineText().withName(nameResult.value).done();
    }
    builder.view().defaultGrid().done();
    const hostTableResult = builder.build();
    expect(hostTableResult.isOk()).toBe(true);
    if (hostTableResult.isErr()) return;
    const hostTable = hostTableResult.value;

    const configResult = LinkFieldConfig.create({
      relationship: 'manyMany',
      foreignTableId: hostTable.id().toString(),
      lookupFieldId: primaryFieldIdResult.value.toString(),
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

    const symmetricResult = linkFieldResult.value.buildSymmetricField({
      foreignTable: ForeignTable.from(hostTable),
      hostTable,
    });
    expect(symmetricResult.isErr()).toBe(true);
  });

  it('returns error for unsupported relationship when resolving fk host table', () => {
    const baseIdResult = createBaseId('r');
    const hostTableIdResult = createTableId('s');
    const foreignTableIdResult = createTableId('t');
    const lookupFieldIdResult = createFieldId('u');
    const linkFieldIdResult = createFieldId('v');
    const linkFieldNameResult = FieldName.create('Link');

    expect(
      [
        baseIdResult,
        hostTableIdResult,
        foreignTableIdResult,
        lookupFieldIdResult,
        linkFieldIdResult,
        linkFieldNameResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      baseIdResult.isErr() ||
      hostTableIdResult.isErr() ||
      foreignTableIdResult.isErr() ||
      lookupFieldIdResult.isErr() ||
      linkFieldIdResult.isErr() ||
      linkFieldNameResult.isErr()
    )
      return;

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
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

    const linkField = linkFieldResult.value as LinkField;
    (linkField as unknown as { configValue: unknown }).configValue = {
      relationship: () => ({ toString: () => 'unsupported' }),
    };

    const resolve = (
      linkField as unknown as {
        resolveFkHostTableName: (params: {
          baseId: BaseId;
          hostTableId: TableId;
          symmetricFieldId?: FieldId;
        }) => Result<unknown, string>;
      }
    ).resolveFkHostTableName;
    const result = resolve({
      baseId: baseIdResult.value,
      hostTableId: hostTableIdResult.value,
    });
    expect(result.isErr()).toBe(true);
  });
});
