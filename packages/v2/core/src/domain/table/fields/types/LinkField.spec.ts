import { ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import type { DomainError } from '../../../shared/DomainError';
import { ForeignTable } from '../../ForeignTable';
import { DbTableName } from '../../DbTableName';
import { UpdateLinkConfigSpec } from '../../specs/field-updates/UpdateLinkConfigSpec';
import { UpdateSingleSelectOptionsSpec } from '../../specs/field-updates/UpdateSingleSelectOptionsSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';
import { ViewId } from '../../views/ViewId';
import { DbFieldName } from '../DbFieldName';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { FieldHasError } from './FieldHasError';
import { LinkField } from './LinkField';
import { LinkFieldConfig } from './LinkFieldConfig';
import { LinkFieldMeta } from './LinkFieldMeta';
import { LinkRelationship } from './LinkRelationship';
import { SelectOption } from './SelectOption';
import { SingleSelectField } from './SingleSelectField';

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

    [
      baseIdResult,
      tableIdResult,
      tableNameResult,
      lookupFieldIdResult,
      lookupFieldNameResult,
      linkFieldIdResult,
      linkFieldNameResult,
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    lookupFieldIdResult._unsafeUnwrap();
    lookupFieldNameResult._unsafeUnwrap();
    linkFieldIdResult._unsafeUnwrap();
    linkFieldNameResult._unsafeUnwrap();

    const tableBuilder = Table.builder()
      .withId(tableIdResult._unsafeUnwrap())
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    tableBuilder
      .field()
      .singleLineText()
      .withId(lookupFieldIdResult._unsafeUnwrap())
      .withName(lookupFieldNameResult._unsafeUnwrap())
      .done();
    tableBuilder.view().defaultGrid().done();
    const foreignTableResult = tableBuilder.build();
    foreignTableResult._unsafeUnwrap();

    const foreignTable = ForeignTable.from(foreignTableResult._unsafeUnwrap());

    const configResult = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: tableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
    });
    linkFieldResult._unsafeUnwrap();

    const lookupResult = linkFieldResult._unsafeUnwrap().lookupField(foreignTable);
    lookupResult._unsafeUnwrap();

    expect(lookupResult._unsafeUnwrap().id().equals(lookupFieldIdResult._unsafeUnwrap())).toBe(
      true
    );
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

    [
      baseIdResult,
      tableIdResult,
      tableNameResult,
      lookupFieldIdResult,
      lookupFieldNameResult,
      linkFieldIdResult,
      linkFieldNameResult,
      otherTableIdResult,
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    lookupFieldIdResult._unsafeUnwrap();
    lookupFieldNameResult._unsafeUnwrap();
    linkFieldIdResult._unsafeUnwrap();
    linkFieldNameResult._unsafeUnwrap();
    otherTableIdResult._unsafeUnwrap();

    const tableBuilder = Table.builder()
      .withId(tableIdResult._unsafeUnwrap())
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    tableBuilder
      .field()
      .singleLineText()
      .withId(lookupFieldIdResult._unsafeUnwrap())
      .withName(lookupFieldNameResult._unsafeUnwrap())
      .done();
    tableBuilder.view().defaultGrid().done();
    const foreignTableResult = tableBuilder.build();
    foreignTableResult._unsafeUnwrap();

    const foreignTable = ForeignTable.from(foreignTableResult._unsafeUnwrap());

    const configResult = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: otherTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
    });
    linkFieldResult._unsafeUnwrap();

    const lookupResult = linkFieldResult._unsafeUnwrap().lookupField(foreignTable);
    lookupResult._unsafeUnwrapErr();
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
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    lookupFieldIdResult._unsafeUnwrap();
    lookupFieldNameResult._unsafeUnwrap();
    symmetricFieldIdResult._unsafeUnwrap();
    symmetricFieldNameResult._unsafeUnwrap();
    visibleFieldIdResult._unsafeUnwrap();
    visibleFieldNameResult._unsafeUnwrap();
    linkFieldIdResult._unsafeUnwrap();
    linkFieldNameResult._unsafeUnwrap();

    const tableBuilder = Table.builder()
      .withId(tableIdResult._unsafeUnwrap())
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    tableBuilder
      .field()
      .singleLineText()
      .withId(lookupFieldIdResult._unsafeUnwrap())
      .withName(lookupFieldNameResult._unsafeUnwrap())
      .done();
    tableBuilder
      .field()
      .singleLineText()
      .withId(symmetricFieldIdResult._unsafeUnwrap())
      .withName(symmetricFieldNameResult._unsafeUnwrap())
      .done();
    tableBuilder
      .field()
      .singleLineText()
      .withId(visibleFieldIdResult._unsafeUnwrap())
      .withName(visibleFieldNameResult._unsafeUnwrap())
      .done();
    tableBuilder.view().defaultGrid().done();
    const foreignTableResult = tableBuilder.build();
    foreignTableResult._unsafeUnwrap();

    const foreignTable = ForeignTable.from(foreignTableResult._unsafeUnwrap());

    const configResult = LinkFieldConfig.create({
      relationship: LinkRelationship.oneMany().toString(),
      foreignTableId: tableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
      symmetricFieldId: symmetricFieldIdResult._unsafeUnwrap().toString(),
      visibleFieldIds: [
        lookupFieldIdResult._unsafeUnwrap().toString(),
        visibleFieldIdResult._unsafeUnwrap().toString(),
      ],
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
    });
    linkFieldResult._unsafeUnwrap();

    const linkField = linkFieldResult._unsafeUnwrap();

    const symmetricFieldResult = linkField.symmetricField(foreignTable);
    symmetricFieldResult._unsafeUnwrap();

    expect(
      symmetricFieldResult._unsafeUnwrap()?.id().equals(symmetricFieldIdResult._unsafeUnwrap())
    ).toBe(true);

    const visibleFieldsResult = linkField.visibleFields(foreignTable);
    visibleFieldsResult._unsafeUnwrap();

    expect(visibleFieldsResult._unsafeUnwrap()?.length).toBe(2);
    if (visibleFieldsResult._unsafeUnwrap()) {
      expect(
        visibleFieldsResult._unsafeUnwrap()?.[0].id().equals(lookupFieldIdResult._unsafeUnwrap())
      ).toBe(true);
      expect(
        visibleFieldsResult._unsafeUnwrap()?.[1].id().equals(visibleFieldIdResult._unsafeUnwrap())
      ).toBe(true);
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

    const configResult = LinkFieldConfig.create({
      baseId: baseIdResult._unsafeUnwrap().toString(),
      relationship: LinkRelationship.oneMany().toString(),
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      isOneWay: false,
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
      symmetricFieldId: symmetricFieldIdResult._unsafeUnwrap().toString(),
      filterByViewId: viewIdResult._unsafeUnwrap().toString(),
      visibleFieldIds: [
        lookupFieldIdResult._unsafeUnwrap().toString(),
        symmetricFieldIdResult._unsafeUnwrap().toString(),
      ],
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
      meta: metaResult._unsafeUnwrap(),
    });
    linkFieldResult._unsafeUnwrap();

    const linkField = linkFieldResult._unsafeUnwrap();

    expect(linkField.symmetricFieldId()?.equals(symmetricFieldIdResult._unsafeUnwrap())).toBe(true);
    expect(linkField.filterByViewId()?.equals(viewIdResult._unsafeUnwrap())).toBe(true);
    expect(linkField.isCrossBase()).toBe(true);
    expect(linkField.isMultipleValue()).toBe(true);

    const visibleFieldIds = linkField.visibleFieldIds();
    expect(visibleFieldIds?.length).toBe(2);
    if (visibleFieldIds) {
      expect(visibleFieldIds[0].equals(lookupFieldIdResult._unsafeUnwrap())).toBe(true);
      expect(visibleFieldIds[1].equals(symmetricFieldIdResult._unsafeUnwrap())).toBe(true);
    }

    const fkHostTableNameResult = linkField.fkHostTableNameString();
    fkHostTableNameResult._unsafeUnwrap();

    expect(fkHostTableNameResult._unsafeUnwrap()).toBe('link_table');

    const selfKeyNameResult = linkField.selfKeyNameString();
    selfKeyNameResult._unsafeUnwrap();

    expect(selfKeyNameResult._unsafeUnwrap()).toBe('__id');

    const foreignKeyNameResult = linkField.foreignKeyNameString();
    foreignKeyNameResult._unsafeUnwrap();

    expect(foreignKeyNameResult._unsafeUnwrap()).toBe('__fk_link');

    const orderColumnResult = linkField.orderColumnName();
    orderColumnResult._unsafeUnwrap();

    expect(orderColumnResult._unsafeUnwrap()).toBe('__id_order');

    const configDtoResult = linkField.configDto();
    configDtoResult._unsafeUnwrap();

    expect(configDtoResult._unsafeUnwrap().symmetricFieldId).toBe(
      symmetricFieldIdResult._unsafeUnwrap().toString()
    );

    expect(linkField.metaDto()?.hasOrderColumn).toBe(true);
  });

  it('exposes db name objects', () => {
    const foreignTableIdResult = createTableId('1');
    const lookupFieldIdResult = createFieldId('2');
    const linkFieldIdResult = createFieldId('3');
    const linkFieldNameResult = FieldName.create('Link');

    const configResult = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      fkHostTableName: 'schema.table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
    });

    const linkField = linkFieldResult._unsafeUnwrap();
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

    const baseId = baseIdResult._unsafeUnwrap();
    const hostTableId = hostTableIdResult._unsafeUnwrap();
    const foreignTableId = foreignTableIdResult._unsafeUnwrap();
    const lookupFieldId = lookupFieldIdResult._unsafeUnwrap();
    const linkFieldId = linkFieldIdResult._unsafeUnwrap();
    const linkFieldName = linkFieldNameResult._unsafeUnwrap();

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

    const fkManyMany = manyMany._unsafeUnwrap().fkHostTableNameString();
    fkManyMany._unsafeUnwrap();

    expect(
      fkManyMany
        ._unsafeUnwrap()
        .startsWith(`${baseId.toString()}.junction_${linkFieldId.toString()}`)
    ).toBe(true);

    const fkManyOne = manyOne._unsafeUnwrap().fkHostTableNameString();
    const fkOneOne = oneOne._unsafeUnwrap().fkHostTableNameString();
    const fkOneMany = oneMany._unsafeUnwrap().fkHostTableNameString();
    expect(fkManyOne._unsafeUnwrap()).toBe(`${baseId.toString()}.${hostTableId.toString()}`);
    expect(fkOneOne._unsafeUnwrap()).toBe(`${baseId.toString()}.${hostTableId.toString()}`);
    expect(fkOneMany._unsafeUnwrap()).toBe(`${baseId.toString()}.${foreignTableId.toString()}`);

    const fkOneManyOneWay = oneManyOneWay._unsafeUnwrap().fkHostTableNameString();

    expect(
      fkOneManyOneWay
        ._unsafeUnwrap()
        .startsWith(`${baseId.toString()}.junction_${linkFieldId.toString()}`)
    ).toBe(true);
  });

  it('prefers provided physical table names when building db config', () => {
    const baseId = createBaseId('m')._unsafeUnwrap();
    const hostTableId = createTableId('n')._unsafeUnwrap();
    const foreignTableId = createTableId('o')._unsafeUnwrap();
    const lookupFieldId = createFieldId('p')._unsafeUnwrap();
    const linkFieldId = createFieldId('q')._unsafeUnwrap();
    const linkFieldName = FieldName.create('Link')._unsafeUnwrap();
    const hostTableDbTableName = DbTableName.rehydrate(
      `${baseId.toString()}.enrollments`
    )._unsafeUnwrap();
    const foreignTableDbTableName = DbTableName.rehydrate(
      `${baseId.toString()}.students`
    )._unsafeUnwrap();

    const buildField = (relationship: string) =>
      LinkFieldConfig.create({
        relationship,
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      }).andThen((config) =>
        LinkField.create({
          id: linkFieldId,
          name: linkFieldName,
          config,
        }).andThen((field) =>
          field
            .ensureDbConfig({
              baseId,
              hostTableId,
              hostTableDbTableName,
              foreignTableDbTableName,
            })
            .map(() => field)
        )
      );

    const manyOne = buildField('manyOne')._unsafeUnwrap();
    const oneMany = buildField('oneMany')._unsafeUnwrap();

    expect(manyOne.fkHostTableNameString()._unsafeUnwrap()).toBe(
      `${baseId.toString()}.enrollments`
    );
    expect(oneMany.fkHostTableNameString()._unsafeUnwrap()).toBe(`${baseId.toString()}.students`);
  });

  it('ensures symmetricFieldId even when db config already exists', () => {
    const baseId = createBaseId('g')._unsafeUnwrap();
    const hostTableId = createTableId('h')._unsafeUnwrap();
    const foreignTableId = createTableId('i')._unsafeUnwrap();
    const lookupFieldId = createFieldId('j')._unsafeUnwrap();
    const linkFieldId = createFieldId('k')._unsafeUnwrap();
    const linkFieldName = FieldName.create('Link')._unsafeUnwrap();

    const field = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      fkHostTableName: `${baseId.toString()}.${hostTableId.toString()}`,
      selfKeyName: '__id',
      foreignKeyName: `__fk_${linkFieldId.toString()}`,
    })
      .andThen((config) =>
        LinkField.create({
          id: linkFieldId,
          name: linkFieldName,
          config,
        })
      )
      ._unsafeUnwrap();

    field.ensureDbConfig({ baseId, hostTableId })._unsafeUnwrap();

    const symmetricFieldId = field.symmetricFieldId();
    expect(symmetricFieldId).toBeDefined();
    expect(symmetricFieldId?.equals(linkFieldId)).toBe(false);

    expect(field.fkHostTableNameString()._unsafeUnwrap()).toBe(
      `${baseId.toString()}.${hostTableId.toString()}`
    );
    expect(field.selfKeyNameString()._unsafeUnwrap()).toBe('__id');
    expect(field.foreignKeyNameString()._unsafeUnwrap()).toBe(`__fk_${linkFieldId.toString()}`);
  });

  it('normalizes same-base baseId when creating a link field', () => {
    const baseId = createBaseId('w')._unsafeUnwrap();
    const hostTableId = createTableId('x')._unsafeUnwrap();
    const foreignTableId = createTableId('y')._unsafeUnwrap();
    const lookupFieldId = createFieldId('z')._unsafeUnwrap();
    const linkFieldId = createFieldId('a')._unsafeUnwrap();
    const linkFieldName = FieldName.create('Link')._unsafeUnwrap();

    const config = LinkFieldConfig.create({
      baseId: baseId.toString(),
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
    })._unsafeUnwrap();

    const field = LinkField.createNew({
      id: linkFieldId,
      name: linkFieldName,
      config,
      baseId,
      hostTableId,
    })._unsafeUnwrap();

    expect(field.baseId()).toBeUndefined();
    expect(field.isCrossBase()).toBe(false);
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

    const baseId = baseIdResult._unsafeUnwrap();
    const hostTableId = hostTableIdResult._unsafeUnwrap();
    const foreignTableId = foreignTableIdResult._unsafeUnwrap();
    const hostPrimaryId = hostPrimaryIdResult._unsafeUnwrap();
    const foreignPrimaryId = foreignPrimaryIdResult._unsafeUnwrap();
    const linkFieldId = linkFieldIdResult._unsafeUnwrap();
    const linkFieldName = linkFieldNameResult._unsafeUnwrap();
    const meta = metaResult._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withId(hostTableId)
      .withBaseId(baseId)
      .withName(hostTableNameResult._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryId)
      .withName(FieldName.create('Host Name')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTableResult = hostBuilder.build();
    hostTableResult._unsafeUnwrap();

    const hostTable = hostTableResult._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(foreignTableNameResult._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTableResult = foreignBuilder.build();
    foreignTableResult._unsafeUnwrap();

    const foreignTable = ForeignTable.from(foreignTableResult._unsafeUnwrap());

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      fkHostTableName: 'schema.link',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
    });

    const linkFieldResult = LinkField.create({
      id: linkFieldId,
      name: linkFieldName,
      config: configResult._unsafeUnwrap(),
      meta,
    });

    const symmetricResult = linkFieldResult._unsafeUnwrap().buildSymmetricField({
      foreignTable,
      hostTable,
    });

    const symmetric = symmetricResult._unsafeUnwrap();
    expect(symmetric.relationship().toString()).toBe('oneMany');
    expect(symmetric.foreignTableId().equals(hostTableId)).toBe(true);
    expect(symmetric.lookupFieldId().equals(hostPrimaryId)).toBe(true);
    expect(symmetric.symmetricFieldId()?.equals(linkFieldId)).toBe(true);
    expect(symmetric.baseId()).toBeUndefined();
    expect(symmetric.meta()?.hasOrderColumn()).toBe(true);
    expect(symmetric.name().toString()).toBe('Host');

    const symmetricSelfKey = symmetric.selfKeyNameString();
    const symmetricForeignKey = symmetric.foreignKeyNameString();
    expect(symmetricSelfKey._unsafeUnwrap()).toBe('__fk_link');
    expect(symmetricForeignKey._unsafeUnwrap()).toBe('__id');
  });

  it('sets symmetric baseId to host base for cross-base links', () => {
    const hostBaseId = createBaseId('h')._unsafeUnwrap();
    const foreignBaseId = createBaseId('i')._unsafeUnwrap();
    const hostTableId = createTableId('j')._unsafeUnwrap();
    const foreignTableId = createTableId('k')._unsafeUnwrap();
    const hostPrimaryId = createFieldId('l')._unsafeUnwrap();
    const foreignPrimaryId = createFieldId('m')._unsafeUnwrap();
    const linkFieldId = createFieldId('n')._unsafeUnwrap();

    const hostBuilder = Table.builder()
      .withId(hostTableId)
      .withBaseId(hostBaseId)
      .withName(TableName.create('Cross Host')._unsafeUnwrap());
    hostBuilder
      .field()
      .singleLineText()
      .withId(hostPrimaryId)
      .withName(FieldName.create('Host Name')._unsafeUnwrap())
      .primary()
      .done();
    hostBuilder.view().defaultGrid().done();
    const hostTable = hostBuilder.build()._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(foreignBaseId)
      .withName(TableName.create('Cross Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = ForeignTable.from(foreignBuilder.build()._unsafeUnwrap());

    const config = LinkFieldConfig.create({
      baseId: foreignBaseId.toString(),
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
    })._unsafeUnwrap();

    const linkField = LinkField.createNew({
      id: linkFieldId,
      name: FieldName.create('Cross Link')._unsafeUnwrap(),
      config,
      baseId: hostBaseId,
      hostTableId,
    })._unsafeUnwrap();

    const symmetric = linkField
      .buildSymmetricField({
        foreignTable,
        hostTable,
      })
      ._unsafeUnwrap();

    expect(symmetric.baseId()?.equals(hostBaseId)).toBe(true);
  });

  it('rejects symmetric build for one-way links', () => {
    const baseIdResult = createBaseId('7');
    const foreignTableIdResult = createTableId('8');
    const lookupFieldIdResult = createFieldId('9');
    const linkFieldIdResult = createFieldId('0');
    const linkFieldNameResult = FieldName.create('Link');

    const configResult = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
      isOneWay: true,
    });

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
    });

    const hostTableResult = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
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

    const foreignTableResult = Table.builder()
      .withId(foreignTableIdResult._unsafeUnwrap())
      .withBaseId(baseIdResult._unsafeUnwrap())
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

    const symmetricResult = linkFieldResult._unsafeUnwrap().buildSymmetricField({
      foreignTable: ForeignTable.from(foreignTableResult._unsafeUnwrap()),
      hostTable: hostTableResult._unsafeUnwrap(),
    });
    symmetricResult._unsafeUnwrapErr();
  });

  it('returns error when symmetric name cannot be generated', () => {
    const baseIdResult = createBaseId('z');
    const tableIdResult = createTableId('y');
    const primaryFieldIdResult = createFieldId('x');
    const linkFieldIdResult = createFieldId('w');
    const linkFieldNameResult = FieldName.create('Link');
    const tableName = 'Host';

    const builder = Table.builder()
      .withId(tableIdResult._unsafeUnwrap())
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(TableName.create(tableName)._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(primaryFieldIdResult._unsafeUnwrap())
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();

    const baseName = tableName;
    const allNames = [
      baseName,
      `${baseName} (linked)`,
      ...Array.from({ length: 99 }, (_, i) => `${baseName} (linked ${i + 2})`),
    ];
    for (const name of allNames) {
      const nameResult = FieldName.create(name);
      nameResult._unsafeUnwrap();

      builder.field().singleLineText().withName(nameResult._unsafeUnwrap()).done();
    }
    builder.view().defaultGrid().done();
    const hostTableResult = builder.build();
    hostTableResult._unsafeUnwrap();

    const hostTable = hostTableResult._unsafeUnwrap();

    const configResult = LinkFieldConfig.create({
      relationship: 'manyMany',
      foreignTableId: hostTable.id().toString(),
      lookupFieldId: primaryFieldIdResult._unsafeUnwrap().toString(),
    });
    configResult._unsafeUnwrap();

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
    });
    linkFieldResult._unsafeUnwrap();

    const symmetricResult = linkFieldResult._unsafeUnwrap().buildSymmetricField({
      foreignTable: ForeignTable.from(hostTable),
      hostTable,
    });
    symmetricResult._unsafeUnwrapErr();
  });

  it('returns error for unsupported relationship when resolving fk host table', () => {
    const baseIdResult = createBaseId('r');
    const hostTableIdResult = createTableId('s');
    const foreignTableIdResult = createTableId('t');
    const lookupFieldIdResult = createFieldId('u');
    const linkFieldIdResult = createFieldId('v');
    const linkFieldNameResult = FieldName.create('Link');

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
      lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
    });

    const linkFieldResult = LinkField.create({
      id: linkFieldIdResult._unsafeUnwrap(),
      name: linkFieldNameResult._unsafeUnwrap(),
      config: configResult._unsafeUnwrap(),
    });

    const linkField = linkFieldResult._unsafeUnwrap() as LinkField;
    (linkField as unknown as { configValue: unknown }).configValue = {
      relationship: () => ({ toString: () => 'unsupported' }),
    };

    const resolve = (
      linkField as unknown as {
        resolveFkHostTableName: (params: {
          baseId: BaseId;
          hostTableId: TableId;
          symmetricFieldId?: FieldId;
        }) => Result<unknown, DomainError>;
      }
    ).resolveFkHostTableName;
    const result = resolve({
      baseId: baseIdResult._unsafeUnwrap(),
      hostTableId: hostTableIdResult._unsafeUnwrap(),
    });
    result._unsafeUnwrapErr();
  });

  describe('onDependencyUpdated', () => {
    it('creates UpdateLinkConfigSpec when referenced select option names change', () => {
      const foreignTableId = createTableId('h')._unsafeUnwrap();
      const lookupFieldId = createFieldId('i')._unsafeUnwrap();
      const statusFieldId = createFieldId('j')._unsafeUnwrap();
      const linkFieldId = createFieldId('k')._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        fkHostTableName: 'link_table',
        selfKeyName: '__id',
        foreignKeyName: '__fk_link',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
        },
      })._unsafeUnwrap();
      const linkField = LinkField.create({
        id: linkFieldId,
        name: FieldName.create('Link')._unsafeUnwrap(),
        config: linkConfig,
      })._unsafeUnwrap();

      const statusField = SingleSelectField.create({
        id: statusFieldId,
        name: FieldName.create('Status')._unsafeUnwrap(),
        options: [
          SelectOption.create({ id: 'cho_active', name: 'Active', color: 'green' })._unsafeUnwrap(),
          SelectOption.create({ id: 'cho_closed', name: 'Closed', color: 'red' })._unsafeUnwrap(),
        ],
      })._unsafeUnwrap();

      const optionsSpec = UpdateSingleSelectOptionsSpec.create(
        statusFieldId,
        DbFieldName.rehydrate('status')._unsafeUnwrap(),
        statusField.selectOptions(),
        [
          SelectOption.create({
            id: 'cho_active',
            name: 'Active Plus',
            color: 'green',
          })._unsafeUnwrap(),
          SelectOption.create({ id: 'cho_closed', name: 'Closed', color: 'red' })._unsafeUnwrap(),
        ]
      );

      const result = linkField.onDependencyUpdated(statusField, [optionsSpec], {} as never);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeInstanceOf(UpdateLinkConfigSpec);

      const updateSpec = result._unsafeUnwrap() as UpdateLinkConfigSpec;
      const nextFilter = updateSpec.nextConfig().filter() as {
        filterSet: Array<{ value?: unknown }>;
      };
      expect(nextFilter.filterSet[0]?.value).toBe('Active Plus');
    });

    it('does nothing when updated field is not referenced in link filter', () => {
      const foreignTableId = createTableId('l')._unsafeUnwrap();
      const lookupFieldId = createFieldId('m')._unsafeUnwrap();
      const statusFieldId = createFieldId('n')._unsafeUnwrap();
      const otherFieldId = createFieldId('o')._unsafeUnwrap();
      const linkFieldId = createFieldId('p')._unsafeUnwrap();

      const linkField = LinkField.create({
        id: linkFieldId,
        name: FieldName.create('Link')._unsafeUnwrap(),
        config: LinkFieldConfig.create({
          relationship: 'manyOne',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          fkHostTableName: 'link_table',
          selfKeyName: '__id',
          foreignKeyName: '__fk_link',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
          },
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

      const otherField = SingleSelectField.create({
        id: otherFieldId,
        name: FieldName.create('Other')._unsafeUnwrap(),
        options: [
          SelectOption.create({ id: 'cho_other', name: 'Other', color: 'blue' })._unsafeUnwrap(),
        ],
      })._unsafeUnwrap();

      const optionsSpec = UpdateSingleSelectOptionsSpec.create(
        otherFieldId,
        DbFieldName.rehydrate('other')._unsafeUnwrap(),
        otherField.selectOptions(),
        [
          SelectOption.create({
            id: 'cho_other',
            name: 'Other Plus',
            color: 'blue',
          })._unsafeUnwrap(),
        ]
      );

      const result = linkField.onDependencyUpdated(otherField, [optionsSpec], {} as never);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeUndefined();
    });
  });

  describe('onFieldDeleted', () => {
    it('falls back lookupFieldId to the foreign primary field when the show-by field is deleted', () => {
      const baseId = createBaseId('q')._unsafeUnwrap();
      const hostTableId = createTableId('r')._unsafeUnwrap();
      const foreignTableId = createTableId('s')._unsafeUnwrap();
      const hostPrimaryFieldId = createFieldId('v')._unsafeUnwrap();
      const foreignPrimaryFieldId = createFieldId('w')._unsafeUnwrap();
      const foreignDisplayFieldId = createFieldId('t')._unsafeUnwrap();
      const linkFieldId = createFieldId('u')._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Foreign')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignPrimaryFieldId)
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignDisplayFieldId)
        .withName(FieldName.create('Display')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTable = foreignBuilder.build()._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withId(hostTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Host')._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(hostPrimaryFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();

      const linkField = LinkField.create({
        id: linkFieldId,
        name: FieldName.create('Foreign Link')._unsafeUnwrap(),
        config: LinkFieldConfig.create({
          relationship: 'oneOne',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignDisplayFieldId.toString(),
          isOneWay: true,
          fkHostTableName: 'host_table',
          selfKeyName: '__id',
          foreignKeyName: '__fk_link',
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

      const deletedField = foreignTable
        .getFields()
        .find((field) => field.id().equals(foreignDisplayFieldId));
      expect(deletedField).toBeDefined();
      if (!deletedField) return;

      const result = linkField.onFieldDeleted(deletedField, {
        table: hostTable,
        sourceTable: foreignTable,
        previousSourceTable: foreignTable,
      });
      expect(result.isOk()).toBe(true);
      const reaction = result._unsafeUnwrap();
      expect(reaction?.spec).toBeInstanceOf(UpdateLinkConfigSpec);
      expect(reaction?.relatedFieldIds.map((id) => id.toString())).toEqual([
        linkFieldId.toString(),
      ]);

      const spec = reaction?.spec as UpdateLinkConfigSpec;
      expect(spec.nextConfig().lookupFieldId().equals(foreignPrimaryFieldId)).toBe(true);
    });

    it('cleans foreign filter and visible field ids when the referenced foreign field is deleted', () => {
      const baseId = createBaseId('x')._unsafeUnwrap();
      const hostTableId = createTableId('y')._unsafeUnwrap();
      const foreignTableId = createTableId('z')._unsafeUnwrap();
      const hostPrimaryFieldId = createFieldId('1')._unsafeUnwrap();
      const foreignPrimaryFieldId = createFieldId('2')._unsafeUnwrap();
      const foreignStatusFieldId = createFieldId('3')._unsafeUnwrap();
      const linkFieldId = createFieldId('4')._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Foreign Clean')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignPrimaryFieldId)
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      foreignBuilder
        .field()
        .singleSelect({
          options: [
            SelectOption.create({ id: 'cho_status', name: 'x', color: 'green' })._unsafeUnwrap(),
          ],
        })
        .withId(foreignStatusFieldId)
        .withName(FieldName.create('Status')._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTable = foreignBuilder.build()._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withId(hostTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Host Clean')._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(hostPrimaryFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();

      const linkField = LinkField.create({
        id: linkFieldId,
        name: FieldName.create('Filtered Link')._unsafeUnwrap(),
        config: LinkFieldConfig.create({
          relationship: 'manyMany',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryFieldId.toString(),
          fkHostTableName: 'clean_link_table',
          selfKeyName: '__id',
          foreignKeyName: '__fk_clean_link',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: foreignStatusFieldId.toString(), operator: 'is', value: 'x' }],
          },
          visibleFieldIds: [foreignStatusFieldId.toString()],
        })._unsafeUnwrap(),
      })._unsafeUnwrap();

      const deletedField = foreignTable
        .getFields()
        .find((field) => field.id().equals(foreignStatusFieldId));
      expect(deletedField).toBeDefined();
      if (!deletedField) return;

      const result = linkField.onFieldDeleted(deletedField, {
        table: hostTable,
        sourceTable: foreignTable,
        previousSourceTable: foreignTable,
      });
      expect(result.isOk()).toBe(true);
      const reaction = result._unsafeUnwrap();
      expect(reaction?.spec).toBeInstanceOf(UpdateLinkConfigSpec);
      expect(reaction?.relatedFieldIds.map((id) => id.toString())).toEqual([
        linkFieldId.toString(),
      ]);

      const spec = reaction?.spec as UpdateLinkConfigSpec;
      expect(spec.nextConfig().filter()).toBeNull();
      expect(spec.nextConfig().visibleFieldIds()).toBeNull();
    });
  });

  describe('onTableDeleted', () => {
    it('converts a link field to singleLineText when its foreign table is deleted', () => {
      const baseId = createBaseId('m')._unsafeUnwrap();
      const hostTableId = createTableId('n')._unsafeUnwrap();
      const foreignTableId = createTableId('o')._unsafeUnwrap();
      const hostPrimaryFieldId = createFieldId('p')._unsafeUnwrap();
      const foreignPrimaryFieldId = createFieldId('q')._unsafeUnwrap();
      const linkFieldId = createFieldId('r')._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withId(foreignTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Foreign Delete')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withId(foreignPrimaryFieldId)
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTable = foreignBuilder.build()._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withId(hostTableId)
        .withBaseId(baseId)
        .withName(TableName.create('Host Delete')._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withId(hostPrimaryFieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();

      const linkField = LinkField.create({
        id: linkFieldId,
        name: FieldName.create('Foreign Link')._unsafeUnwrap(),
        config: LinkFieldConfig.create({
          relationship: 'manyMany',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignPrimaryFieldId.toString(),
          isOneWay: true,
          fkHostTableName: 'delete_link_table',
          selfKeyName: '__id',
          foreignKeyName: '__fk_delete_link',
        })._unsafeUnwrap(),
      })._unsafeUnwrap();
      linkField.setHasError(FieldHasError.error());
      linkField.setDescription('preserve me')._unsafeUnwrap();

      const hostWithLink = hostTable
        .addField(linkField, { foreignTables: [foreignTable] })
        ._unsafeUnwrap();
      const fieldInHost = hostWithLink
        .getField((field) => field.id().equals(linkFieldId))
        ._unsafeUnwrap() as LinkField;

      const result = fieldInHost.onTableDeleted(foreignTable, {
        table: hostWithLink,
        hooks: {
          createFieldUpdateAfterPersistHook: () => async () =>
            ok({
              events: [],
              table: hostWithLink,
            }),
        },
      });
      expect(result.isOk()).toBe(true);
      const reaction = result._unsafeUnwrap();
      expect(reaction?.spec).toBeInstanceOf(TableUpdateFieldTypeSpec);
      expect(typeof reaction?.afterPersist).toBe('function');

      const updatedTable = reaction?.spec.mutate(hostWithLink);
      expect(updatedTable?.isOk()).toBe(true);
      const updatedField = updatedTable
        ?._unsafeUnwrap()
        .getField((field) => field.id().equals(linkFieldId));
      expect(updatedField?.isOk()).toBe(true);

      expect(updatedField?._unsafeUnwrap().type().toString()).toBe('singleLineText');
      expect(updatedField?._unsafeUnwrap().hasError().isError()).toBe(true);
      expect(updatedField?._unsafeUnwrap().description()).toBe('preserve me');
    });
  });
});

const buildLinkAutoCreateTables = (params?: {
  foreignPrimaryType?: 'singleLineText' | 'number';
  selfLink?: boolean;
  lookupFieldId?: FieldId;
}) => {
  const baseId = createBaseId('z')._unsafeUnwrap();
  const foreignTableId = createTableId('y')._unsafeUnwrap();
  const hostTableId = params?.selfLink ? foreignTableId : createTableId('x')._unsafeUnwrap();
  const foreignLookupFieldId = createFieldId('w')._unsafeUnwrap();
  const foreignAltFieldId = createFieldId('v')._unsafeUnwrap();
  const linkFieldId = createFieldId('u')._unsafeUnwrap();

  const foreignBuilder = Table.builder()
    .withId(foreignTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Foreign Auto Create')._unsafeUnwrap());

  if ((params?.foreignPrimaryType ?? 'singleLineText') === 'number') {
    foreignBuilder
      .field()
      .number()
      .withId(foreignLookupFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
  } else {
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignLookupFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
  }

  foreignBuilder
    .field()
    .singleLineText()
    .withId(foreignAltFieldId)
    .withName(FieldName.create('Alt')._unsafeUnwrap())
    .done();
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder.build()._unsafeUnwrap();

  const hostBuilder = Table.builder()
    .withId(hostTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Host Auto Create')._unsafeUnwrap());
  hostBuilder
    .field()
    .singleLineText()
    .withId(createFieldId('t')._unsafeUnwrap())
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  hostBuilder.view().defaultGrid().done();
  const hostTable = hostBuilder.build()._unsafeUnwrap();

  const linkField = LinkField.create({
    id: linkFieldId,
    name: FieldName.create('Link')._unsafeUnwrap(),
    config: LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: (params?.lookupFieldId ?? foreignLookupFieldId).toString(),
      isOneWay: true,
    })._unsafeUnwrap(),
  })._unsafeUnwrap();

  return {
    hostTable,
    foreignTable,
    linkField,
    foreignPrimaryFieldId: foreignLookupFieldId,
    foreignAltFieldId,
  };
};

describe('LinkField.validateAutoCreateTarget', () => {
  it('rejects self-link auto-create targets', () => {
    const { hostTable, linkField } = buildLinkAutoCreateTables({ selfLink: true });

    const result = linkField.validateAutoCreateTarget(hostTable, hostTable);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('paste.link_auto_create_self_link_unsupported');
  });

  it('rejects non-primary lookup targets', () => {
    const { hostTable, foreignTable, foreignAltFieldId } = buildLinkAutoCreateTables({
      lookupFieldId: createFieldId('v')._unsafeUnwrap(),
    });
    const linkField = LinkField.create({
      id: createFieldId('s')._unsafeUnwrap(),
      name: FieldName.create('Link')._unsafeUnwrap(),
      config: LinkFieldConfig.create({
        relationship: 'oneMany',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignAltFieldId.toString(),
        isOneWay: true,
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    const result = linkField.validateAutoCreateTarget(hostTable, foreignTable);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('paste.link_auto_create_requires_primary_lookup');
  });

  it('propagates foreign-table primary-only validation errors', () => {
    const { hostTable, foreignTable, linkField } = buildLinkAutoCreateTables({
      foreignPrimaryType: 'number',
    });

    const result = linkField.validateAutoCreateTarget(hostTable, foreignTable);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('paste.link_auto_create_requires_text_primary');
  });

  it('allows auto-create when lookup targets the foreign text primary', () => {
    const { hostTable, foreignTable, linkField } = buildLinkAutoCreateTables();

    const result = linkField.validateAutoCreateTarget(hostTable, foreignTable);
    expect(result).toEqual(ok(undefined));
  });
});
