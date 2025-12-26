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
    expect([fieldIdResult, symmetricIdResult, fkHostResult].every((r) => r.isOk())).toBe(true);
    if (fieldIdResult.isErr() || symmetricIdResult.isErr() || fkHostResult.isErr()) return;

    const fieldId = fieldIdResult.value;
    const symmetricFieldId = symmetricIdResult.value;
    const fkHostTableName = fkHostResult.value;

    const manyMany = LinkFieldConfig.buildDbConfig({
      fkHostTableName,
      relationship: LinkRelationship.manyMany(),
      fieldId,
      symmetricFieldId,
      isOneWay: false,
    });
    expect(manyMany.isOk()).toBe(true);
    if (manyMany.isErr()) return;
    expect(manyMany.value.selfKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${symmetricFieldId.toString()}`
    );
    expect(manyMany.value.foreignKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${fieldId.toString()}`
    );

    const manyOne = LinkFieldConfig.buildDbConfig({
      fkHostTableName,
      relationship: LinkRelationship.manyOne(),
      fieldId,
      symmetricFieldId,
      isOneWay: false,
    });
    expect(manyOne.isOk()).toBe(true);
    if (manyOne.isErr()) return;
    expect(manyOne.value.selfKeyName.value()._unsafeUnwrap()).toBe('__id');
    expect(manyOne.value.foreignKeyName.value()._unsafeUnwrap()).toBe(`__fk_${fieldId.toString()}`);

    const oneOne = LinkFieldConfig.buildDbConfig({
      fkHostTableName,
      relationship: LinkRelationship.oneOne(),
      fieldId,
      symmetricFieldId,
      isOneWay: false,
    });
    expect(oneOne.isOk()).toBe(true);
    if (oneOne.isErr()) return;
    expect(oneOne.value.selfKeyName.value()._unsafeUnwrap()).toBe('__id');
    expect(oneOne.value.foreignKeyName.value()._unsafeUnwrap()).toBe(`__fk_${fieldId.toString()}`);

    const oneMany = LinkFieldConfig.buildDbConfig({
      fkHostTableName,
      relationship: LinkRelationship.oneMany(),
      fieldId,
      symmetricFieldId,
      isOneWay: false,
    });
    expect(oneMany.isOk()).toBe(true);
    if (oneMany.isErr()) return;
    expect(oneMany.value.selfKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${symmetricFieldId.toString()}`
    );
    expect(oneMany.value.foreignKeyName.value()._unsafeUnwrap()).toBe('__id');
  });

  it('builds oneMany db config for one-way links', () => {
    const fieldIdResult = createFieldId('c');
    const symmetricIdResult = createFieldId('d');
    const fkHostResult = DbTableName.rehydrate('schema.oneway');
    expect([fieldIdResult, symmetricIdResult, fkHostResult].every((r) => r.isOk())).toBe(true);
    if (fieldIdResult.isErr() || symmetricIdResult.isErr() || fkHostResult.isErr()) return;

    const configResult = LinkFieldConfig.buildDbConfig({
      fkHostTableName: fkHostResult.value,
      relationship: LinkRelationship.oneMany(),
      fieldId: fieldIdResult.value,
      symmetricFieldId: symmetricIdResult.value,
      isOneWay: true,
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;
    expect(configResult.value.selfKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${symmetricIdResult.value.toString()}`
    );
    expect(configResult.value.foreignKeyName.value()._unsafeUnwrap()).toBe(
      `__fk_${fieldIdResult.value.toString()}`
    );
  });

  it('swaps db config and rejects conflicting updates', () => {
    const fkHostResult = DbTableName.rehydrate('schema.swap');
    const selfKeyResult = DbFieldName.rehydrate('__self');
    const foreignKeyResult = DbFieldName.rehydrate('__foreign');
    expect([fkHostResult, selfKeyResult, foreignKeyResult].every((r) => r.isOk())).toBe(true);
    if (fkHostResult.isErr() || selfKeyResult.isErr() || foreignKeyResult.isErr()) return;

    const fkHostNameResult = fkHostResult.value.value();
    const selfKeyNameResult = selfKeyResult.value.value();
    const foreignKeyNameResult = foreignKeyResult.value.value();
    expect([fkHostNameResult, selfKeyNameResult, foreignKeyNameResult].every((r) => r.isOk())).toBe(
      true
    );
    if (fkHostNameResult.isErr() || selfKeyNameResult.isErr() || foreignKeyNameResult.isErr())
      return;

    const swapped = LinkFieldConfig.swapDbConfig({
      fkHostTableName: fkHostNameResult.value,
      selfKeyName: selfKeyNameResult.value,
      foreignKeyName: foreignKeyNameResult.value,
    });
    expect(swapped.isOk()).toBe(true);
    if (swapped.isErr()) return;
    expect(swapped.value.selfKeyName.value()._unsafeUnwrap()).toBe('__foreign');
    expect(swapped.value.foreignKeyName.value()._unsafeUnwrap()).toBe('__self');

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: `tbl${'a'.repeat(16)}`,
      lookupFieldId: `fld${'b'.repeat(16)}`,
      fkHostTableName: 'schema.swap',
      selfKeyName: '__self',
      foreignKeyName: '__foreign',
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const conflictResult = configResult.value.withDbConfig({
      fkHostTableName: DbTableName.rehydrate('schema.conflict')._unsafeUnwrap(),
      selfKeyName: selfKeyResult.value,
      foreignKeyName: foreignKeyResult.value,
    });
    expect(conflictResult.isErr()).toBe(true);
  });

  it('sets symmetric field id only once', () => {
    const symmetricIdResult = createFieldId('i');
    const otherIdResult = createFieldId('j');
    expect([symmetricIdResult, otherIdResult].every((r) => r.isOk())).toBe(true);
    if (symmetricIdResult.isErr() || otherIdResult.isErr()) return;

    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: `tbl${'k'.repeat(16)}`,
      lookupFieldId: `fld${'l'.repeat(16)}`,
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const first = configResult.value.withSymmetricFieldId(symmetricIdResult.value);
    expect(first.isOk()).toBe(true);
    if (first.isErr()) return;

    const same = first.value.withSymmetricFieldId(symmetricIdResult.value);
    expect(same.isOk()).toBe(true);

    const different = first.value.withSymmetricFieldId(otherIdResult.value);
    expect(different.isErr()).toBe(true);
  });

  it('handles db config getters and visibility settings', () => {
    const configResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: `tbl${'a'.repeat(16)}`,
      lookupFieldId: `fld${'b'.repeat(16)}`,
      filterByViewId: null,
      visibleFieldIds: null,
    });
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const config = configResult.value;
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
    expect(withIdsResult.isOk()).toBe(true);
    if (withIdsResult.isErr()) return;

    const withIds = withIdsResult.value;
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
    expect(configResult.isOk()).toBe(true);
    if (configResult.isErr()) return;

    const config = configResult.value;
    const fkHost = DbTableName.rehydrate('schema.host')._unsafeUnwrap();
    const selfKey = DbFieldName.rehydrate('__self')._unsafeUnwrap();
    const foreignKey = DbFieldName.rehydrate('__foreign')._unsafeUnwrap();

    const fkConflict = config.withDbConfig({
      fkHostTableName: DbTableName.rehydrate('schema.other')._unsafeUnwrap(),
      selfKeyName: selfKey,
      foreignKeyName: foreignKey,
    });
    expect(fkConflict.isErr()).toBe(true);

    const selfConflict = config.withDbConfig({
      fkHostTableName: fkHost,
      selfKeyName: DbFieldName.rehydrate('__self_alt')._unsafeUnwrap(),
      foreignKeyName: foreignKey,
    });
    expect(selfConflict.isErr()).toBe(true);

    const foreignConflict = config.withDbConfig({
      fkHostTableName: fkHost,
      selfKeyName: selfKey,
      foreignKeyName: DbFieldName.rehydrate('__foreign_alt')._unsafeUnwrap(),
    });
    expect(foreignConflict.isErr()).toBe(true);
  });

  it('returns errors for unsupported relationships in buildDbConfig', () => {
    const fkHostResult = DbTableName.rehydrate('schema.unsupported');
    const fieldIdResult = createFieldId('k');
    expect([fkHostResult, fieldIdResult].every((r) => r.isOk())).toBe(true);
    if (fkHostResult.isErr() || fieldIdResult.isErr()) return;

    const fakeRelationship = { toString: () => 'unsupported' } as unknown as LinkRelationship;
    const result = LinkFieldConfig.buildDbConfig({
      fkHostTableName: fkHostResult.value,
      relationship: fakeRelationship,
      fieldId: fieldIdResult.value,
      symmetricFieldId: undefined,
      isOneWay: false,
    });
    expect(result.isErr()).toBe(true);
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
    expect([configAResult, configBResult].every((r) => r.isOk())).toBe(true);
    if (configAResult.isErr() || configBResult.isErr()) return;

    const configA = configAResult.value;
    const configB = configBResult.value;
    expect(configA.equals(configA)).toBe(true);
    expect(configA.equals(configB)).toBe(false);
  });
});
