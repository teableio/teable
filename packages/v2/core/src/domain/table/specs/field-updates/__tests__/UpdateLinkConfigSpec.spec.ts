import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../../base/BaseId';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { LinkField } from '../../../fields/types/LinkField';
import { LinkFieldConfig } from '../../../fields/types/LinkFieldConfig';
import { LinkFieldMeta } from '../../../fields/types/LinkFieldMeta';
import { Table } from '../../../Table';
import { TableId } from '../../../TableId';
import { TableName } from '../../../TableName';
import { UpdateLinkConfigSpec } from '../UpdateLinkConfigSpec';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();

const buildConfig = (params: {
  relationship: string;
  foreignTableId: string;
  lookupFieldId: string;
  isOneWay?: boolean;
  symmetricFieldId?: string;
}) => LinkFieldConfig.create(params)._unsafeUnwrap();

const buildTableWithLinkField = (params: {
  baseId: BaseId;
  tableId: TableId;
  linkFieldId: FieldId;
  config: LinkFieldConfig;
  meta?: LinkFieldMeta;
}) => {
  const primaryFieldId = createFieldId('p');
  const tableName = TableName.create('Test')._unsafeUnwrap();
  const primaryName = FieldName.create('Title')._unsafeUnwrap();
  const linkName = FieldName.create('Link')._unsafeUnwrap();

  const builder = Table.builder()
    .withId(params.tableId)
    .withBaseId(params.baseId)
    .withName(tableName);
  builder.field().singleLineText().withId(primaryFieldId).withName(primaryName).primary().done();
  const linkBuilder = builder
    .field()
    .link()
    .withId(params.linkFieldId)
    .withName(linkName)
    .withConfig(params.config);
  if (params.meta) {
    linkBuilder.withMeta(params.meta);
  }
  linkBuilder.done();
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

describe('UpdateLinkConfigSpec', () => {
  describe('hasOrderColumn meta computation', () => {
    const baseId = createBaseId('a');
    const tableId = createTableId('a');
    const foreignTableId = createTableId('b');
    const linkFieldId = createFieldId('1');
    const primaryFieldId = createFieldId('p');

    const configParams = {
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: primaryFieldId.toString(),
    };

    describe('oneMany relationship', () => {
      it('sets hasOrderColumn = true when converting oneWay to twoWay', () => {
        const previousConfig = buildConfig({
          ...configParams,
          relationship: 'oneMany',
          isOneWay: true,
        });
        const nextConfig = buildConfig({
          ...configParams,
          relationship: 'oneMany',
          isOneWay: false,
          symmetricFieldId: createFieldId('s').toString(),
        });

        const table = buildTableWithLinkField({
          baseId,
          tableId,
          linkFieldId,
          config: previousConfig,
          // no meta for oneMany + oneWay
        });

        const spec = UpdateLinkConfigSpec.create(linkFieldId, previousConfig, nextConfig);
        const result = spec.mutate(table);
        const updatedTable = result._unsafeUnwrap();

        const updatedField = updatedTable
          .getField((f) => f.id().equals(linkFieldId))
          ._unsafeUnwrap() as LinkField;
        expect(updatedField.hasOrderColumn()).toBe(true);
        expect(updatedField.meta()?.toDto().hasOrderColumn).toBe(true);
      });

      it('sets hasOrderColumn = false (no meta) when converting twoWay to oneWay', () => {
        const previousConfig = buildConfig({
          ...configParams,
          relationship: 'oneMany',
          isOneWay: false,
          symmetricFieldId: createFieldId('s').toString(),
        });
        const nextConfig = buildConfig({
          ...configParams,
          relationship: 'oneMany',
          isOneWay: true,
        });

        const meta = LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap();
        const table = buildTableWithLinkField({
          baseId,
          tableId,
          linkFieldId,
          config: previousConfig,
          meta,
        });

        const spec = UpdateLinkConfigSpec.create(linkFieldId, previousConfig, nextConfig);
        const result = spec.mutate(table);
        const updatedTable = result._unsafeUnwrap();

        const updatedField = updatedTable
          .getField((f) => f.id().equals(linkFieldId))
          ._unsafeUnwrap() as LinkField;
        expect(updatedField.hasOrderColumn()).toBe(false);
        expect(updatedField.meta()).toBeUndefined();
      });

      it('recomputes hasOrderColumn for oneWay to oneWay relationship change', () => {
        const previousConfig = buildConfig({
          ...configParams,
          relationship: 'oneMany',
          isOneWay: true,
        });
        // Relationship changes but stays oneWay; manyMany has __order in junction
        const nextConfig = buildConfig({
          ...configParams,
          relationship: 'manyMany',
          isOneWay: true,
        });

        const table = buildTableWithLinkField({
          baseId,
          tableId,
          linkFieldId,
          config: previousConfig,
        });

        const spec = UpdateLinkConfigSpec.create(linkFieldId, previousConfig, nextConfig);
        const result = spec.mutate(table);
        const updatedTable = result._unsafeUnwrap();

        const updatedField = updatedTable
          .getField((f) => f.id().equals(linkFieldId))
          ._unsafeUnwrap() as LinkField;
        // manyMany always has order column, so meta is recomputed
        expect(updatedField.hasOrderColumn()).toBe(true);
      });
    });

    describe('manyMany relationship', () => {
      it('sets hasOrderColumn = true for TwoWay', () => {
        const previousConfig = buildConfig({
          ...configParams,
          relationship: 'manyMany',
          isOneWay: true,
        });
        const nextConfig = buildConfig({
          ...configParams,
          relationship: 'manyMany',
          isOneWay: false,
          symmetricFieldId: createFieldId('s').toString(),
        });

        const table = buildTableWithLinkField({
          baseId,
          tableId,
          linkFieldId,
          config: previousConfig,
          meta: LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap(),
        });

        const spec = UpdateLinkConfigSpec.create(linkFieldId, previousConfig, nextConfig);
        const result = spec.mutate(table);
        const updatedTable = result._unsafeUnwrap();

        const updatedField = updatedTable
          .getField((f) => f.id().equals(linkFieldId))
          ._unsafeUnwrap() as LinkField;
        expect(updatedField.hasOrderColumn()).toBe(true);
      });

      it('sets hasOrderColumn = true for OneWay', () => {
        const config = buildConfig({
          ...configParams,
          relationship: 'manyMany',
          isOneWay: true,
        });

        const meta = LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap();
        const table = buildTableWithLinkField({
          baseId,
          tableId,
          linkFieldId,
          config,
          meta,
        });

        const field = table
          .getField((f) => f.id().equals(linkFieldId))
          ._unsafeUnwrap() as LinkField;
        expect(field.hasOrderColumn()).toBe(true);
      });
    });

    describe('oneOne relationship', () => {
      it('sets hasOrderColumn = true regardless of oneWay', () => {
        const previousConfig = buildConfig({
          ...configParams,
          relationship: 'oneOne',
          isOneWay: true,
        });
        const nextConfig = buildConfig({
          ...configParams,
          relationship: 'oneOne',
          isOneWay: false,
          symmetricFieldId: createFieldId('s').toString(),
        });

        const meta = LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap();
        const table = buildTableWithLinkField({
          baseId,
          tableId,
          linkFieldId,
          config: previousConfig,
          meta,
        });

        const spec = UpdateLinkConfigSpec.create(linkFieldId, previousConfig, nextConfig);
        const result = spec.mutate(table);
        const updatedTable = result._unsafeUnwrap();

        const updatedField = updatedTable
          .getField((f) => f.id().equals(linkFieldId))
          ._unsafeUnwrap() as LinkField;
        expect(updatedField.hasOrderColumn()).toBe(true);
      });
    });

    describe('manyOne relationship', () => {
      it('sets hasOrderColumn = true regardless of oneWay', () => {
        const previousConfig = buildConfig({
          ...configParams,
          relationship: 'manyOne',
          isOneWay: true,
        });
        const nextConfig = buildConfig({
          ...configParams,
          relationship: 'manyOne',
          isOneWay: false,
          symmetricFieldId: createFieldId('s').toString(),
        });

        const meta = LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap();
        const table = buildTableWithLinkField({
          baseId,
          tableId,
          linkFieldId,
          config: previousConfig,
          meta,
        });

        const spec = UpdateLinkConfigSpec.create(linkFieldId, previousConfig, nextConfig);
        const result = spec.mutate(table);
        const updatedTable = result._unsafeUnwrap();

        const updatedField = updatedTable
          .getField((f) => f.id().equals(linkFieldId))
          ._unsafeUnwrap() as LinkField;
        expect(updatedField.hasOrderColumn()).toBe(true);
      });
    });

    describe('relationship type changes', () => {
      it('recomputes hasOrderColumn when relationship changes from manyMany to oneMany (twoWay)', () => {
        const symFieldId = createFieldId('s');
        const previousConfig = buildConfig({
          ...configParams,
          relationship: 'manyMany',
          isOneWay: false,
          symmetricFieldId: symFieldId.toString(),
        });
        const nextConfig = buildConfig({
          ...configParams,
          relationship: 'oneMany',
          isOneWay: false,
          symmetricFieldId: symFieldId.toString(),
        });

        const meta = LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap();
        const table = buildTableWithLinkField({
          baseId,
          tableId,
          linkFieldId,
          config: previousConfig,
          meta,
        });

        const spec = UpdateLinkConfigSpec.create(linkFieldId, previousConfig, nextConfig);
        const result = spec.mutate(table);
        const updatedTable = result._unsafeUnwrap();

        const updatedField = updatedTable
          .getField((f) => f.id().equals(linkFieldId))
          ._unsafeUnwrap() as LinkField;
        // oneMany + TwoWay → hasOrderColumn = true
        expect(updatedField.hasOrderColumn()).toBe(true);
      });
    });
  });

  describe('symmetricFieldId preservation during twoWay→oneWay conversion', () => {
    const baseId = createBaseId('a');
    const tableId = createTableId('a');
    const foreignTableId = createTableId('b');
    const linkFieldId = createFieldId('1');
    const symFieldId = createFieldId('s');
    const primaryFieldId = createFieldId('p');

    const configParams = {
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: primaryFieldId.toString(),
    };

    it('preserves symmetricFieldId from previous config when converting manyMany twoWay to oneWay', () => {
      const previousConfig = buildConfig({
        ...configParams,
        relationship: 'manyMany',
        isOneWay: false,
        symmetricFieldId: symFieldId.toString(),
      });
      // nextConfig without symmetricFieldId (simulates user input)
      const nextConfig = buildConfig({
        ...configParams,
        relationship: 'manyMany',
        isOneWay: true,
      });

      const meta = LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap();
      const table = buildTableWithLinkField({
        baseId,
        tableId,
        linkFieldId,
        config: previousConfig,
        meta,
      });

      const spec = UpdateLinkConfigSpec.create(linkFieldId, previousConfig, nextConfig);
      const result = spec.mutate(table);
      const updatedTable = result._unsafeUnwrap();

      const updatedField = updatedTable
        .getField((f) => f.id().equals(linkFieldId))
        ._unsafeUnwrap() as LinkField;
      // symmetricFieldId must be preserved for junction table naming
      expect(updatedField.symmetricFieldId()?.toString()).toBe(symFieldId.toString());
    });

    it('preserves symmetricFieldId in nextConfig when already set', () => {
      const previousConfig = buildConfig({
        ...configParams,
        relationship: 'manyMany',
        isOneWay: false,
        symmetricFieldId: symFieldId.toString(),
      });
      // nextConfig WITH symmetricFieldId already set
      const nextConfig = buildConfig({
        ...configParams,
        relationship: 'manyMany',
        isOneWay: true,
        symmetricFieldId: symFieldId.toString(),
      });

      const meta = LinkFieldMeta.create({ hasOrderColumn: true })._unsafeUnwrap();
      const table = buildTableWithLinkField({
        baseId,
        tableId,
        linkFieldId,
        config: previousConfig,
        meta,
      });

      const spec = UpdateLinkConfigSpec.create(linkFieldId, previousConfig, nextConfig);
      const result = spec.mutate(table);
      const updatedTable = result._unsafeUnwrap();

      const updatedField = updatedTable
        .getField((f) => f.id().equals(linkFieldId))
        ._unsafeUnwrap() as LinkField;
      expect(updatedField.symmetricFieldId()?.toString()).toBe(symFieldId.toString());
    });
  });

  describe('isOneWayChanging', () => {
    const primaryFieldId = createFieldId('p');
    const foreignTableId = createTableId('b');

    it('returns true when oneWay changes', () => {
      const prev = buildConfig({
        relationship: 'manyMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: primaryFieldId.toString(),
        isOneWay: true,
      });
      const next = buildConfig({
        relationship: 'manyMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: primaryFieldId.toString(),
        isOneWay: false,
        symmetricFieldId: createFieldId('s').toString(),
      });
      const spec = UpdateLinkConfigSpec.create(createFieldId('1'), prev, next);
      expect(spec.isOneWayChanging()).toBe(true);
    });

    it('returns false when oneWay stays the same', () => {
      const prev = buildConfig({
        relationship: 'manyMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: primaryFieldId.toString(),
        isOneWay: true,
      });
      const next = buildConfig({
        relationship: 'oneMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: primaryFieldId.toString(),
        isOneWay: true,
      });
      const spec = UpdateLinkConfigSpec.create(createFieldId('1'), prev, next);
      expect(spec.isOneWayChanging()).toBe(false);
    });
  });
});
