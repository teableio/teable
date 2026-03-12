import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../../base/BaseId';
import { DbFieldName } from '../../../fields/DbFieldName';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { LinkField } from '../../../fields/types/LinkField';
import { LinkFieldConfig } from '../../../fields/types/LinkFieldConfig';
import { Table } from '../../../Table';
import { TableId } from '../../../TableId';
import { TableName } from '../../../TableName';
import type { ITableSpecVisitor } from '../../ITableSpecVisitor';
import { UpdateLinkRelationshipSpec } from '../UpdateLinkRelationshipSpec';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();

const baseId = createBaseId('a');
const tableId = createTableId('a');
const foreignTableId = createTableId('b');
const fieldId = createFieldId('c');
const lookupFieldId = createFieldId('d');
const symmetricFieldId = createFieldId('e');
const dbFieldName = DbFieldName.rehydrate('__fk_relationship')._unsafeUnwrap();

const buildConfig = (params: {
  relationship: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
  isOneWay?: boolean;
  symmetricFieldId?: FieldId;
}) =>
  LinkFieldConfig.create({
    relationship: params.relationship,
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    isOneWay: params.isOneWay,
    symmetricFieldId: params.symmetricFieldId?.toString(),
  })._unsafeUnwrap();

const buildLinkTable = (linkFieldId: FieldId, config: LinkFieldConfig) => {
  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create('Relationship Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(createFieldId('p'))
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Link')._unsafeUnwrap())
    .withConfig(config)
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildNumberTable = (targetFieldId: FieldId) => {
  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create('Non Link Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(createFieldId('q'))
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(targetFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('UpdateLinkRelationshipSpec', () => {
  it.each([
    {
      name: 'one-way oneMany to two-way oneMany',
      previousConfig: buildConfig({ relationship: 'oneMany', isOneWay: true }),
      nextConfig: buildConfig({
        relationship: 'oneMany',
        isOneWay: false,
        symmetricFieldId,
      }),
      expected: {
        relationshipTypeChanging: false,
        oneWayChanging: true,
        requiresCreation: true,
        requiresDeletion: false,
        junctionToFk: true,
        fkToJunction: false,
      },
    },
    {
      name: 'two-way oneMany to one-way oneMany',
      previousConfig: buildConfig({
        relationship: 'oneMany',
        isOneWay: false,
        symmetricFieldId,
      }),
      nextConfig: buildConfig({ relationship: 'oneMany', isOneWay: true }),
      expected: {
        relationshipTypeChanging: false,
        oneWayChanging: true,
        requiresCreation: false,
        requiresDeletion: true,
        junctionToFk: false,
        fkToJunction: true,
      },
    },
    {
      name: 'manyMany to oneOne',
      previousConfig: buildConfig({
        relationship: 'manyMany',
        isOneWay: false,
        symmetricFieldId,
      }),
      nextConfig: buildConfig({
        relationship: 'oneOne',
        isOneWay: false,
        symmetricFieldId,
      }),
      expected: {
        relationshipTypeChanging: true,
        oneWayChanging: false,
        requiresCreation: false,
        requiresDeletion: false,
        junctionToFk: true,
        fkToJunction: false,
      },
    },
    {
      name: 'manyOne to manyMany',
      previousConfig: buildConfig({
        relationship: 'manyOne',
        isOneWay: false,
      }),
      nextConfig: buildConfig({
        relationship: 'manyMany',
        isOneWay: false,
        symmetricFieldId,
      }),
      expected: {
        relationshipTypeChanging: true,
        oneWayChanging: false,
        requiresCreation: false,
        requiresDeletion: false,
        junctionToFk: false,
        fkToJunction: true,
      },
    },
    {
      name: 'oneOne to manyOne keeps fk storage',
      previousConfig: buildConfig({
        relationship: 'oneOne',
        isOneWay: false,
      }),
      nextConfig: buildConfig({
        relationship: 'manyOne',
        isOneWay: false,
      }),
      expected: {
        relationshipTypeChanging: true,
        oneWayChanging: false,
        requiresCreation: false,
        requiresDeletion: false,
        junctionToFk: false,
        fkToJunction: false,
      },
    },
    {
      name: 'same relationship and direction is a no-op',
      previousConfig: buildConfig({
        relationship: 'oneMany',
        isOneWay: false,
        symmetricFieldId,
      }),
      nextConfig: buildConfig({
        relationship: 'oneMany',
        isOneWay: false,
        symmetricFieldId,
      }),
      expected: {
        relationshipTypeChanging: false,
        oneWayChanging: false,
        requiresCreation: false,
        requiresDeletion: false,
        junctionToFk: false,
        fkToJunction: false,
      },
    },
  ])('derives transition flags for $name', ({ previousConfig, nextConfig, expected }) => {
    const spec = UpdateLinkRelationshipSpec.create({
      fieldId,
      dbFieldName,
      previousConfig,
      nextConfig,
    });

    expect(spec.fieldId().equals(fieldId)).toBe(true);
    expect(spec.dbFieldName().equals(dbFieldName)).toBe(true);
    expect(spec.previousConfig().equals(previousConfig)).toBe(true);
    expect(spec.nextConfig().equals(nextConfig)).toBe(true);
    expect(spec.previousRelationship().equals(previousConfig.relationship())).toBe(true);
    expect(spec.nextRelationship().equals(nextConfig.relationship())).toBe(true);
    expect(spec.previousIsOneWay()).toBe(previousConfig.isOneWay());
    expect(spec.nextIsOneWay()).toBe(nextConfig.isOneWay());
    expect(spec.isRelationshipTypeChanging()).toBe(expected.relationshipTypeChanging);
    expect(spec.isOneWayChanging()).toBe(expected.oneWayChanging);
    expect(spec.requiresSymmetricFieldCreation()).toBe(expected.requiresCreation);
    expect(spec.requiresSymmetricFieldDeletion()).toBe(expected.requiresDeletion);
    expect(spec.isJunctionToFkConversion()).toBe(expected.junctionToFk);
    expect(spec.isFkToJunctionConversion()).toBe(expected.fkToJunction);
  });

  it('captures the computed next config from the already-updated link field', () => {
    const previousConfig = buildConfig({ relationship: 'oneMany', isOneWay: true });
    const nextConfig = buildConfig({
      relationship: 'oneMany',
      isOneWay: false,
      symmetricFieldId,
    });
    const table = buildLinkTable(fieldId, nextConfig);

    const spec = UpdateLinkRelationshipSpec.create({
      fieldId,
      dbFieldName,
      previousConfig,
      nextConfig,
    });

    const result = spec.mutate(table);
    const updatedField = table
      .getField((candidate) => candidate.id().equals(fieldId))
      ._unsafeUnwrap();

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(table);
    expect(spec.computedNextConfig()?.equals((updatedField as LinkField).config())).toBe(true);
    expect(updatedField).toBeInstanceOf(LinkField);
    expect((updatedField as LinkField).config().equals(spec.computedNextConfig()!)).toBe(true);
  });

  it('leaves computed next config unset when the field is missing or no longer a link field', () => {
    const previousConfig = buildConfig({ relationship: 'manyOne', isOneWay: false });
    const nextConfig = buildConfig({
      relationship: 'manyMany',
      isOneWay: false,
      symmetricFieldId,
    });

    const missingFieldSpec = UpdateLinkRelationshipSpec.create({
      fieldId,
      dbFieldName,
      previousConfig,
      nextConfig,
    });
    const missingFieldTable = buildLinkTable(createFieldId('f'), previousConfig);
    expect(missingFieldSpec.mutate(missingFieldTable).isOk()).toBe(true);
    expect(missingFieldSpec.computedNextConfig()).toBeUndefined();

    const nonLinkSpec = UpdateLinkRelationshipSpec.create({
      fieldId,
      dbFieldName,
      previousConfig,
      nextConfig,
    });
    const nonLinkTable = buildNumberTable(fieldId);
    expect(nonLinkSpec.mutate(nonLinkTable).isOk()).toBe(true);
    expect(nonLinkSpec.computedNextConfig()).toBeUndefined();
  });

  it('accepts the table spec visitor', () => {
    let visited = false;
    const spec = UpdateLinkRelationshipSpec.create({
      fieldId,
      dbFieldName,
      previousConfig: buildConfig({ relationship: 'manyOne', isOneWay: false }),
      nextConfig: buildConfig({
        relationship: 'manyMany',
        isOneWay: false,
        symmetricFieldId,
      }),
    });

    const visitor = {
      visitUpdateLinkRelationship: () => {
        visited = true;
        return ok(undefined);
      },
    };

    expect(spec.accept(visitor as unknown as ITableSpecVisitor<void>).isOk()).toBe(true);
    expect(visited).toBe(true);
  });
});
