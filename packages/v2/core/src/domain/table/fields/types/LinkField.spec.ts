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
});
