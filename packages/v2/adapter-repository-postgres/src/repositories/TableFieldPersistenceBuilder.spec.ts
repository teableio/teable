import { describe, expect, it } from 'vitest';

import {
  ActorId,
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  ConditionalLookupField,
  ConditionalLookupOptions,
  DefaultTableMapper,
  FieldHasError,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaField,
  LookupField,
  LookupOptions,
  NumberField,
  NumberFormatting,
  RollupExpression,
  RollupField,
  RollupFieldConfig,
  Table,
  TableId,
  TableName,
  TimeZone,
} from '@teable/v2-core';
import { TableFieldPersistenceBuilder } from './TableFieldPersistenceBuilder';

describe('TableFieldPersistenceBuilder', () => {
  it('preserves hasError when building persistence rows', () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Duplicate Builder')._unsafeUnwrap());

    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();
    builder
      .field()
      .formula()
      .withName(FieldName.create('Broken Formula')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('1')._unsafeUnwrap())
      .done();

    const table = builder.build()._unsafeUnwrap();
    const formulaField = table
      .getFields()
      .find((field) => field.name().toString() === 'Broken Formula');
    expect(formulaField).toBeDefined();
    formulaField?.setHasError(FieldHasError.error());

    const persistenceBuilder = new TableFieldPersistenceBuilder({
      table,
      tableMapper: new DefaultTableMapper(),
      now: new Date('2026-03-23T00:00:00.000Z'),
      actorId: ActorId.create('system')._unsafeUnwrap().toString(),
    });

    const dbMeta = persistenceBuilder.buildDbFieldMeta()._unsafeUnwrap();
    const rows = persistenceBuilder.buildRowsFromDbMeta(dbMeta)._unsafeUnwrap();
    const formulaRow = rows.find((row) => row.name === 'Broken Formula');

    expect(formulaRow?.has_error).toBe(true);
  });

  it('rebuilds missing lookup inner options from the domain field', () => {
    const baseId = BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const innerFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Lookup Fallback')._unsafeUnwrap());

    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();

    builder.addFieldFromResult(
      LookupField.create({
        id: lookupFieldId,
        name: FieldName.create('Formula Lookup')._unsafeUnwrap(),
        innerField: FormulaField.create({
          id: innerFieldId,
          name: FieldName.create('Amount Formula')._unsafeUnwrap(),
          expression: FormulaExpression.create('1')._unsafeUnwrap(),
          timeZone: TimeZone.create('Asia/Shanghai')._unsafeUnwrap(),
          formatting: NumberFormatting.create({
            type: 'currency',
            precision: 2,
            symbol: '¥',
          })._unsafeUnwrap(),
          resultType: {
            cellValueType: CellValueType.number(),
            isMultipleCellValue: CellValueMultiplicity.single(),
          },
        })._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: `fld${'f'.repeat(16)}`,
          foreignTableId: `tbl${'f'.repeat(16)}`,
          lookupFieldId: `fld${'g'.repeat(16)}`,
        })._unsafeUnwrap(),
      })
    );
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    const mapper = new DefaultTableMapper();
    const dto = mapper.toDTO(table)._unsafeUnwrap();
    const lookupDto = dto.fields.find((field) => field.id === lookupFieldId.toString());
    if (!lookupDto) throw new Error('Lookup DTO not found');
    delete (lookupDto as { options?: unknown }).options;

    const persistenceBuilder = new TableFieldPersistenceBuilder({
      table,
      tableMapper: mapper,
      now: new Date('2026-04-09T00:00:00.000Z'),
      actorId: ActorId.create('system')._unsafeUnwrap().toString(),
      dto,
    });

    const field = table
      .getField((candidate) => candidate.id().equals(lookupFieldId))
      ._unsafeUnwrap();
    const row = persistenceBuilder.buildRowForField(field)._unsafeUnwrap();

    expect(JSON.parse(row.options ?? 'null')).toEqual({
      expression: '1',
      timeZone: 'Asia/Shanghai',
      formatting: {
        type: 'currency',
        precision: 2,
        symbol: '¥',
      },
    });
  });

  it('rebuilds missing conditional lookup inner options and outer config from the domain field', () => {
    const baseId = BaseId.create(`bse${'h'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'h'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
    const conditionalLookupFieldId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
    const innerFieldId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Conditional Lookup Fallback')._unsafeUnwrap());

    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();

    builder.addFieldFromResult(
      ConditionalLookupField.create({
        id: conditionalLookupFieldId,
        name: FieldName.create('Conditional Formula Lookup')._unsafeUnwrap(),
        innerField: FormulaField.create({
          id: innerFieldId,
          name: FieldName.create('Lookup Formula')._unsafeUnwrap(),
          expression: FormulaExpression.create('2')._unsafeUnwrap(),
          formatting: NumberFormatting.create({ type: 'percent', precision: 1 })._unsafeUnwrap(),
          resultType: {
            cellValueType: CellValueType.number(),
            isMultipleCellValue: CellValueMultiplicity.single(),
          },
        })._unsafeUnwrap(),
        conditionalLookupOptions: ConditionalLookupOptions.create({
          foreignTableId: `tbl${'k'.repeat(16)}`,
          lookupFieldId: `fld${'k'.repeat(16)}`,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: primaryFieldId.toString(), operator: 'is', value: 'open' }],
            },
            limit: 5,
          },
        })._unsafeUnwrap(),
      })
    );
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    const mapper = new DefaultTableMapper();
    const dto = mapper.toDTO(table)._unsafeUnwrap();
    const conditionalLookupDto = dto.fields.find(
      (field) => field.id === conditionalLookupFieldId.toString()
    );
    if (!conditionalLookupDto || conditionalLookupDto.type !== 'conditionalLookup') {
      throw new Error('Conditional lookup DTO not found');
    }
    delete (conditionalLookupDto as { options?: unknown }).options;
    delete (conditionalLookupDto as { innerOptions?: unknown }).innerOptions;

    const persistenceBuilder = new TableFieldPersistenceBuilder({
      table,
      tableMapper: mapper,
      now: new Date('2026-04-09T00:00:00.000Z'),
      actorId: ActorId.create('system')._unsafeUnwrap().toString(),
      dto,
    });

    const field = table
      .getField((candidate) => candidate.id().equals(conditionalLookupFieldId))
      ._unsafeUnwrap();
    const row = persistenceBuilder.buildRowForField(field)._unsafeUnwrap();

    expect(JSON.parse(row.options ?? 'null')).toEqual({
      expression: '2',
      formatting: {
        type: 'percent',
        precision: 1,
      },
    });
    expect(JSON.parse(row.lookup_options ?? 'null')).toEqual({
      foreignTableId: `tbl${'k'.repeat(16)}`,
      lookupFieldId: `fld${'k'.repeat(16)}`,
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: primaryFieldId.toString(), operator: 'is', value: 'open' }],
      },
      limit: 5,
    });
  });

  it('rebuilds missing rollup options and config from the domain field', () => {
    const baseId = BaseId.create(`bse${'l'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
    const rollupFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
    const valuesFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Rollup Fallback')._unsafeUnwrap());

    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();

    builder.addFieldFromResult(
      RollupField.create({
        id: rollupFieldId,
        name: FieldName.create('Total Amount')._unsafeUnwrap(),
        valuesField: NumberField.create({
          id: valuesFieldId,
          name: FieldName.create('Amount')._unsafeUnwrap(),
          formatting: NumberFormatting.create({ type: 'decimal', precision: 0 })._unsafeUnwrap(),
        })._unsafeUnwrap(),
        config: RollupFieldConfig.create({
          linkFieldId: `fld${'o'.repeat(16)}`,
          foreignTableId: `tbl${'o'.repeat(16)}`,
          lookupFieldId: valuesFieldId.toString(),
        })._unsafeUnwrap(),
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
        timeZone: TimeZone.create('Asia/Shanghai')._unsafeUnwrap(),
        formatting: NumberFormatting.create({
          type: 'currency',
          precision: 0,
          symbol: '$',
        })._unsafeUnwrap(),
      })
    );
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    const mapper = new DefaultTableMapper();
    const dto = mapper.toDTO(table)._unsafeUnwrap();
    const rollupDto = dto.fields.find((field) => field.id === rollupFieldId.toString());
    if (!rollupDto || rollupDto.type !== 'rollup') {
      throw new Error('Rollup DTO not found');
    }
    delete (rollupDto as { options?: unknown }).options;
    delete (rollupDto as { config?: unknown }).config;

    const persistenceBuilder = new TableFieldPersistenceBuilder({
      table,
      tableMapper: mapper,
      now: new Date('2026-04-09T00:00:00.000Z'),
      actorId: ActorId.create('system')._unsafeUnwrap().toString(),
      dto,
    });

    const field = table
      .getField((candidate) => candidate.id().equals(rollupFieldId))
      ._unsafeUnwrap();
    const row = persistenceBuilder.buildRowForField(field)._unsafeUnwrap();

    expect(JSON.parse(row.options ?? 'null')).toEqual({
      expression: 'sum({values})',
      timeZone: 'Asia/Shanghai',
      formatting: {
        type: 'currency',
        precision: 0,
        symbol: '$',
      },
    });
    expect(JSON.parse(row.lookup_options ?? 'null')).toEqual({
      linkFieldId: `fld${'o'.repeat(16)}`,
      foreignTableId: `tbl${'o'.repeat(16)}`,
      lookupFieldId: valuesFieldId.toString(),
    });
  });
});
