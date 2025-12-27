import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { Table } from '../../Table';
import { TableName } from '../../TableName';
import type { Field } from '../Field';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { RollupExpression } from '../types/RollupExpression';
import type { RollupField } from '../types/RollupField';
import { RollupFieldConfig } from '../types/RollupFieldConfig';
import { FieldForeignTableValidationVisitor } from './FieldForeignTableValidationVisitor';

const unwrap = <T>(result: Result<T, string>): T => {
  if (result.isErr()) {
    throw new Error(result.error);
  }
  return result.value;
};

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
  const lookupField = table.fields().find((field) => field.id().equals(lookupFieldId));
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

describe('FieldForeignTableValidationVisitor (rollup)', () => {
  it('resolves rollup field result types from foreign tables', () => {
    const baseId = unwrap(BaseId.generate());
    const foreign = buildForeignTable(baseId);
    const host = buildHostTable(baseId, {
      foreignTableId: foreign.table.id().toString(),
      valuesField: foreign.lookupField,
      lookupFieldId: foreign.lookupFieldId.toString(),
    });

    const rollupFields = host.fields().filter((field) => field.type().toString() === 'rollup');
    const result = FieldForeignTableValidationVisitor.validate(rollupFields, {
      table: host,
      foreignTables: [foreign.table],
    });
    result._unsafeUnwrap();

    const rollup = host.fields().find((f) => f.type().toString() === 'rollup') as RollupField;
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

    const rollupFields = host.fields().filter((field) => field.type().toString() === 'rollup');
    const result = FieldForeignTableValidationVisitor.validate(rollupFields, {
      table: host,
      foreignTables: [foreign.table],
    });
    result._unsafeUnwrapErr();

    expect(result.error).toBe('RollupField link field not found');
  });

  it('fails when foreign table is missing', () => {
    const baseId = unwrap(BaseId.generate());
    const foreign = buildForeignTable(baseId);
    const host = buildHostTable(baseId, {
      foreignTableId: foreign.table.id().toString(),
      valuesField: foreign.lookupField,
      lookupFieldId: foreign.lookupFieldId.toString(),
    });

    const rollupFields = host.fields().filter((field) => field.type().toString() === 'rollup');
    const result = FieldForeignTableValidationVisitor.validate(rollupFields, {
      table: host,
      foreignTables: [],
    });
    result._unsafeUnwrapErr();

    expect(result.error).toBe('RollupField foreign table not loaded');
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

    const rollupFields = host.fields().filter((field) => field.type().toString() === 'rollup');
    const result = FieldForeignTableValidationVisitor.validate(rollupFields, {
      table: host,
      foreignTables: [foreign.table],
    });
    result._unsafeUnwrapErr();

    expect(result.error).toBe('RollupField lookup field not found');
  });
});
