import { describe, expect, it } from 'vitest';

import { DbTableName } from '../../DbTableName';
import { DbFieldName } from '../DbFieldName';
import { FieldId } from '../FieldId';
import { LinkFieldConfig } from './LinkFieldConfig';
import { LinkRelationship } from './LinkRelationship';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('LinkFieldConfig', () => {
  it('builds db config for all relationships', () => {
    const fieldIdResult = createFieldId('a');
    const symmetricIdResult = createFieldId('b');
    const fkHostResult = DbTableName.rehydrate('schema.table');
    [fieldIdResult, symmetricIdResult, fkHostResult].forEach((r) => r._unsafeUnwrap());
    fieldIdResult._unsafeUnwrap();
    symmetricIdResult._unsafeUnwrap();
    fkHostResult._unsafeUnwrap();

    const fieldId = fieldIdResult._unsafeUnwrap();
    const symmetricFieldId = symmetricIdResult._unsafeUnwrap();
    const fkHostTableName = fkHostResult._unsafeUnwrap();

    const manyMany = LinkFieldConfig.buildDbConfig({
      fkHostTableName,
      relationship: LinkRelationship.manyMany(),
      fieldId,
      symmetricFieldId,
      isOneWay: false,
    });
    const manyManyConfig = manyMany._unsafeUnwrap();
    expect(manyManyConfig.selfKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${symmetricFieldId.toString()}`
    );
    expect(manyManyConfig.foreignKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${fieldId.toString()}`
    );

    const manyOne = LinkFieldConfig.buildDbConfig({
      fkHostTableName,
      relationship: LinkRelationship.manyOne(),
      fieldId,
      symmetricFieldId,
      isOneWay: false,
    });
    const manyOneConfig = manyOne._unsafeUnwrap();
    expect(manyOneConfig.selfKeyName.value()._unsafeUnwrap()).toBe('__id');
    expect(manyOneConfig.foreignKeyName.value()._unsafeUnwrap()).toBe(`__fk_${fieldId.toString()}`);

    const oneOne = LinkFieldConfig.buildDbConfig({
      fkHostTableName,
      relationship: LinkRelationship.oneOne(),
      fieldId,
      symmetricFieldId,
      isOneWay: false,
    });
    const oneOneConfig = oneOne._unsafeUnwrap();
    expect(oneOneConfig.selfKeyName.value()._unsafeUnwrap()).toBe('__id');
    expect(oneOneConfig.foreignKeyName.value()._unsafeUnwrap()).toBe(`__fk_${fieldId.toString()}`);

    const oneMany = LinkFieldConfig.buildDbConfig({
      fkHostTableName,
      relationship: LinkRelationship.oneMany(),
      fieldId,
      symmetricFieldId,
      isOneWay: false,
    });
    const oneManyConfig = oneMany._unsafeUnwrap();
    expect(oneManyConfig.selfKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${symmetricFieldId.toString()}`
    );
    expect(oneManyConfig.foreignKeyName.value()._unsafeUnwrap()).toBe('__id');
  });

  it('builds oneMany db config for one-way links', () => {
    const fieldIdResult = createFieldId('c');
    const symmetricIdResult = createFieldId('d');
    const fkHostResult = DbTableName.rehydrate('schema.oneway');
    [fieldIdResult, symmetricIdResult, fkHostResult].forEach((r) => r._unsafeUnwrap());
    fieldIdResult._unsafeUnwrap();
    symmetricIdResult._unsafeUnwrap();
    fkHostResult._unsafeUnwrap();

    const configResult = LinkFieldConfig.buildDbConfig({
      fkHostTableName: fkHostResult._unsafeUnwrap(),
      relationship: LinkRelationship.oneMany(),
      fieldId: fieldIdResult._unsafeUnwrap(),
      symmetricFieldId: symmetricIdResult._unsafeUnwrap(),
      isOneWay: true,
    });
    const config = configResult._unsafeUnwrap();
    expect(config.selfKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${symmetricIdResult._unsafeUnwrap().toString()}`
    );
    expect(config.foreignKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${fieldIdResult._unsafeUnwrap().toString()}`
    );
  });

  it('swaps db config and rejects conflicting updates', () => {
    const fkHostResult = DbTableName.rehydrate('schema.swap');
    const selfKeyResult = DbFieldName.rehydrate('__self');
    const foreignKeyResult = DbFieldName.rehydrate('__foreign');
    [fkHostResult, selfKeyResult, foreignKeyResult].forEach((r) => r._unsafeUnwrap());
    fkHostResult._unsafeUnwrap();
    selfKeyResult._unsafeUnwrap();
    foreignKeyResult._unsafeUnwrap();

    const fkHostNameResult = fkHostResult._unsafeUnwrap().value();
    const selfKeyNameResult = selfKeyResult._unsafeUnwrap().value();
    const foreignKeyNameResult = foreignKeyResult._unsafeUnwrap().value();
    [fkHostNameResult, selfKeyNameResult, foreignKeyNameResult].forEach((r) => r._unsafeUnwrap());

    const swapped = LinkFieldConfig.swapDbConfig({
      fkHostTableName: fkHostNameResult._unsafeUnwrap(),
      selfKeyName: selfKeyNameResult._unsafeUnwrap(),
      foreignKeyName: foreignKeyNameResult._unsafeUnwrap(),
    });
    const swappedConfig = swapped._unsafeUnwrap();
    expect(swappedConfig.selfKeyName.value()._unsafeUnwrap()).toBe('__foreign');
    expect(swappedConfig.foreignKeyName.value()._unsafeUnwrap()).toBe('__self');

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: `tbl${'a'.repeat(16)}`,
      lookupFieldId: `fld${'b'.repeat(16)}`,
      fkHostTableName: 'schema.swap',
      selfKeyName: '__self',
      foreignKeyName: '__foreign',
    });
    configResult._unsafeUnwrap();

    const conflictResult = configResult._unsafeUnwrap().withDbConfig({
      fkHostTableName: DbTableName.rehydrate('schema.conflict')._unsafeUnwrap(),
      selfKeyName: selfKeyResult._unsafeUnwrap(),
      foreignKeyName: foreignKeyResult._unsafeUnwrap(),
    });
    conflictResult._unsafeUnwrapErr();
  });

  it('sets symmetric field id only once', () => {
    const symmetricIdResult = createFieldId('i');
    const otherIdResult = createFieldId('j');
    [symmetricIdResult, otherIdResult].forEach((r) => r._unsafeUnwrap());

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: `tbl${'k'.repeat(16)}`,
      lookupFieldId: `fld${'l'.repeat(16)}`,
    });
    configResult._unsafeUnwrap();

    const first = configResult
      ._unsafeUnwrap()
      .withSymmetricFieldId(symmetricIdResult._unsafeUnwrap());
    const firstConfig = first._unsafeUnwrap();

    const same = firstConfig.withSymmetricFieldId(symmetricIdResult._unsafeUnwrap());
    same._unsafeUnwrap();

    const different = firstConfig.withSymmetricFieldId(otherIdResult._unsafeUnwrap());
    different._unsafeUnwrapErr();
  });

  it('handles db config getters and visibility settings', () => {
    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: `tbl${'a'.repeat(16)}`,
      lookupFieldId: `fld${'b'.repeat(16)}`,
      filterByViewId: null,
      visibleFieldIds: null,
    });
    configResult._unsafeUnwrap();

    const config = configResult._unsafeUnwrap();
    expect(config.hasDbConfig()).toBe(false);
    expect(config.visibleFieldIds()).toBeNull();
    expect(config.filterByViewId()).toBeNull();

    const withIdsResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: `tbl${'c'.repeat(16)}`,
      lookupFieldId: `fld${'d'.repeat(16)}`,
      filterByViewId: `viw${'e'.repeat(16)}`,
      visibleFieldIds: [`fld${'d'.repeat(16)}`],
    });
    withIdsResult._unsafeUnwrap();

    const withIds = withIdsResult._unsafeUnwrap();
    expect(withIds.visibleFieldIds()?.length).toBe(1);
    expect(withIds.filterByViewId()?.toString()).toBe(`viw${'e'.repeat(16)}`);
  });

  it('rejects mismatched db config updates', () => {
    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: `tbl${'f'.repeat(16)}`,
      lookupFieldId: `fld${'g'.repeat(16)}`,
      fkHostTableName: 'schema.host',
      selfKeyName: '__self',
      foreignKeyName: '__foreign',
    });
    configResult._unsafeUnwrap();

    const config = configResult._unsafeUnwrap();
    const fkHost = DbTableName.rehydrate('schema.host')._unsafeUnwrap();
    const selfKey = DbFieldName.rehydrate('__self')._unsafeUnwrap();
    const foreignKey = DbFieldName.rehydrate('__foreign')._unsafeUnwrap();

    const fkConflict = config.withDbConfig({
      fkHostTableName: DbTableName.rehydrate('schema.other')._unsafeUnwrap(),
      selfKeyName: selfKey,
      foreignKeyName: foreignKey,
    });
    fkConflict._unsafeUnwrapErr();

    const selfConflict = config.withDbConfig({
      fkHostTableName: fkHost,
      selfKeyName: DbFieldName.rehydrate('__self_alt')._unsafeUnwrap(),
      foreignKeyName: foreignKey,
    });
    selfConflict._unsafeUnwrapErr();

    const foreignConflict = config.withDbConfig({
      fkHostTableName: fkHost,
      selfKeyName: selfKey,
      foreignKeyName: DbFieldName.rehydrate('__foreign_alt')._unsafeUnwrap(),
    });
    foreignConflict._unsafeUnwrapErr();
  });

  it('returns errors for unsupported relationships in buildDbConfig', () => {
    const fkHostResult = DbTableName.rehydrate('schema.unsupported');
    const fieldIdResult = createFieldId('k');
    [fkHostResult, fieldIdResult].forEach((r) => r._unsafeUnwrap());
    fkHostResult._unsafeUnwrap();
    fieldIdResult._unsafeUnwrap();

    const fakeRelationship = { toString: () => 'unsupported' } as unknown as LinkRelationship;
    const result = LinkFieldConfig.buildDbConfig({
      fkHostTableName: fkHostResult._unsafeUnwrap(),
      relationship: fakeRelationship,
      fieldId: fieldIdResult._unsafeUnwrap(),
      symmetricFieldId: undefined,
      isOneWay: false,
    });
    result._unsafeUnwrapErr();
  });

  it('compares optional, nullable, and array values', () => {
    const configAResult = LinkFieldConfig.create({
      baseId: `bse${'a'.repeat(16)}`,
      relationship: 'manyOne',
      foreignTableId: `tbl${'l'.repeat(16)}`,
      lookupFieldId: `fld${'m'.repeat(16)}`,
      filterByViewId: null,
      visibleFieldIds: [`fld${'m'.repeat(16)}`],
    });
    const configBResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: `tbl${'l'.repeat(16)}`,
      lookupFieldId: `fld${'m'.repeat(16)}`,
      filterByViewId: undefined,
      visibleFieldIds: null,
    });
    [configAResult, configBResult].forEach((r) => r._unsafeUnwrap());
    configAResult._unsafeUnwrap();
    configBResult._unsafeUnwrap();

    const configA = configAResult._unsafeUnwrap();
    const configB = configBResult._unsafeUnwrap();
    expect(configA.equals(configA)).toBe(true);
    expect(configA.equals(configB)).toBe(false);
  });
});
