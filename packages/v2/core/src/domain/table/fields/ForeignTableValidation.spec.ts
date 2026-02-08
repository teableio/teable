import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import type { DomainError } from '../../shared/DomainError';
import { Table } from '../Table';
import { TableName } from '../TableName';
import { Field } from './Field';
import { FieldId } from './FieldId';
import { FieldName } from './FieldName';
import { validateForeignTablesForFields } from './ForeignTableRelatedField';
import { LinkFieldConfig } from './types/LinkFieldConfig';
import { RollupExpression } from './types/RollupExpression';
import type { RollupField } from './types/RollupField';
import { RollupFieldConfig } from './types/RollupFieldConfig';

const unwrap = <T>(result: Result<T, DomainError>): T => result._unsafeUnwrap();
const buildFieldSpec = (
  build: (builder: ReturnType<typeof Field.specs>) => ReturnType<typeof Field.specs>
) => build(Field.specs()).build()._unsafeUnwrap();

const buildForeignTable = (baseId: BaseId) => {
  const builder = Table.builder()
    .withBaseId(baseId)
    .withName(unwrap(TableName.create('Foreign')));
  const lookupFieldId = unwrap(FieldId.generate());
  builder
    .field()
    .singleLineText()
    .withName(unwrap(FieldName.create('Title')))
    .primary()
    .done();
  builder
    .field()
    .number()
    .withName(unwrap(FieldName.create('Amount')))
    .withId(lookupFieldId)
    .done();
  builder.view().defaultGrid().done();
  const table = unwrap(builder.build());
  const lookupField = table.getFields(
    buildFieldSpec((specs) => specs.withFieldId(lookupFieldId))
  )[0];
  if (!lookupField) throw new Error('Lookup field not found');
  return { table, lookupFieldId, lookupField };
};

const buildHostTable = (
  baseId: BaseId,
  params: {
    foreignTableId: string;
    valuesField: Field;
    linkFieldId?: FieldId;
    lookupFieldId: string;
    rollupLinkFieldId?: string;
  }
) => {
  const builder = Table.builder()
    .withBaseId(baseId)
    .withName(unwrap(TableName.create('Host')));
  const linkFieldId = params.linkFieldId ?? unwrap(FieldId.generate());
  const linkConfig = unwrap(
    LinkFieldConfig.create({
      relationship: 'manyMany',
      foreignTableId: params.foreignTableId,
      lookupFieldId: params.lookupFieldId,
    })
  );
  builder
    .field()
    .link()
    .withName(unwrap(FieldName.create('Links')))
    .withId(linkFieldId)
    .withConfig(linkConfig)
    .done();

  const rollupConfig = unwrap(
    RollupFieldConfig.create({
      linkFieldId: params.rollupLinkFieldId ?? linkFieldId.toString(),
      foreignTableId: params.foreignTableId,
      lookupFieldId: params.lookupFieldId,
    })
  );
  builder
    .field()
    .rollup()
    .withName(unwrap(FieldName.create('Total')))
    .withConfig(rollupConfig)
    .withExpression(unwrap(RollupExpression.create('countall({values})')))
    .withValuesField(params.valuesField)
    .done();

  builder.view().defaultGrid().done();
  return unwrap(builder.build());
};

describe('ForeignTableValidation (rollup)', () => {
  it('resolves rollup field result types from foreign tables', () => {
    const baseId = unwrap(BaseId.generate());
    const foreign = buildForeignTable(baseId);
    const host = buildHostTable(baseId, {
      foreignTableId: foreign.table.id().toString(),
      valuesField: foreign.lookupField,
      lookupFieldId: foreign.lookupFieldId.toString(),
    });

    const rollupFields = host.getFields(buildFieldSpec((specs) => specs.isRollup()));
    validateForeignTablesForFields(rollupFields, {
      hostTable: host,
      foreignTables: [foreign.table],
    })._unsafeUnwrap();

    const rollup = host.getFields(buildFieldSpec((specs) => specs.isRollup()))[0] as
      | RollupField
      | undefined;
    expect(rollup).toBeDefined();
    if (!rollup) return;
    const cellValueType = unwrap(rollup.cellValueType());
    const isMultiple = unwrap(rollup.isMultipleCellValue());
    expect(cellValueType.toString()).toBe('number');
    expect(isMultiple.toBoolean()).toBe(false);
    expect(rollup.dependencies().map((id) => id.toString())).toEqual([
      rollup.linkFieldId().toString(),
    ]);
  });

  it('fails when link field is missing', () => {
    const baseId = unwrap(BaseId.generate());
    const foreign = buildForeignTable(baseId);
    const missingLinkId = unwrap(FieldId.generate());
    const host = buildHostTable(baseId, {
      foreignTableId: foreign.table.id().toString(),
      valuesField: foreign.lookupField,
      lookupFieldId: foreign.lookupFieldId.toString(),
      rollupLinkFieldId: missingLinkId.toString(),
    });

    const rollupFields = host.getFields(buildFieldSpec((specs) => specs.isRollup()));
    const error = validateForeignTablesForFields(rollupFields, {
      hostTable: host,
      foreignTables: [foreign.table],
    })._unsafeUnwrapErr();

    expect(error.message).toBe('RollupField link field not found');
  });

  it('fails when foreign table is missing', () => {
    const baseId = unwrap(BaseId.generate());
    const foreign = buildForeignTable(baseId);
    const host = buildHostTable(baseId, {
      foreignTableId: foreign.table.id().toString(),
      valuesField: foreign.lookupField,
      lookupFieldId: foreign.lookupFieldId.toString(),
    });

    const rollupFields = host.getFields(buildFieldSpec((specs) => specs.isRollup()));
    const error = validateForeignTablesForFields(rollupFields, {
      hostTable: host,
      foreignTables: [],
    })._unsafeUnwrapErr();

    expect(error.message).toBe('RollupField foreign table not loaded');
  });

  it('fails when lookup field is missing', () => {
    const baseId = unwrap(BaseId.generate());
    const foreign = buildForeignTable(baseId);
    const missingLookupId = unwrap(FieldId.generate());
    const host = buildHostTable(baseId, {
      foreignTableId: foreign.table.id().toString(),
      valuesField: foreign.lookupField,
      lookupFieldId: missingLookupId.toString(),
    });

    const rollupFields = host.getFields(buildFieldSpec((specs) => specs.isRollup()));
    const error = validateForeignTablesForFields(rollupFields, {
      hostTable: host,
      foreignTables: [foreign.table],
    })._unsafeUnwrapErr();

    expect(error.message).toBe('RollupField lookup field not found');
  });
});
