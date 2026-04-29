/* eslint-disable @typescript-eslint/naming-convention */
import {
  CellValueType,
  DateFieldCore,
  DateFormattingPreset,
  DriverClient,
  FieldType,
  NumberFieldCore,
  SingleLineTextFieldCore,
  TimeFormatting,
} from '@teable/core';
import type { FieldCore, IFilter } from '@teable/core';
import knex from 'knex';
import type { IRecordQueryFilterContext } from '../../../features/record/query-builder/record-query-builder.interface';
import type { IDbProvider } from '../../db.provider.interface';
import type { AbstractCellValueFilter } from '../cell-value-filter.abstract';
import { AbstractFilterQuery } from '../filter-query.abstract';
import { FilterQueryPostgres } from '../postgres/filter-query.postgres';

const knexBuilder = knex({ client: 'pg' });
const dbProviderStub = { driver: DriverClient.Pg } as unknown as IDbProvider;
const mainTableAlias = 'main_table as main';

function assignBaseField<T extends FieldCore>(
  field: T,
  params: {
    id: string;
    name?: string;
    dbFieldName: string;
    type: FieldType;
    cellValueType: CellValueType;
    options: T['options'];
  }
): T {
  field.id = params.id;
  field.name = params.name ?? params.id;
  field.dbFieldName = params.dbFieldName;
  field.type = params.type;
  field.options = params.options;
  field.cellValueType = params.cellValueType;
  field.isMultipleCellValue = false;
  field.isLookup = false;
  field.updateDbFieldType();
  return field;
}

function createNumberField(id: string, dbFieldName: string): NumberFieldCore {
  return assignBaseField(new NumberFieldCore(), {
    id,
    dbFieldName,
    type: FieldType.Number,
    cellValueType: CellValueType.Number,
    options: NumberFieldCore.defaultOptions(),
  });
}

function createTextField(id: string, dbFieldName: string, name?: string): SingleLineTextFieldCore {
  return assignBaseField(new SingleLineTextFieldCore(), {
    id,
    name,
    dbFieldName,
    type: FieldType.SingleLineText,
    cellValueType: CellValueType.String,
    options: SingleLineTextFieldCore.defaultOptions(),
  });
}

function createDateField(id: string, dbFieldName: string): DateFieldCore {
  const options = DateFieldCore.defaultOptions();
  options.formatting = {
    date: DateFormattingPreset.ISO,
    time: TimeFormatting.None,
    timeZone: 'UTC',
  };
  return assignBaseField(new DateFieldCore(), {
    id,
    dbFieldName,
    type: FieldType.Date,
    cellValueType: CellValueType.DateTime,
    options,
  });
}

class ThrowingFilterQuery extends AbstractFilterQuery {
  private createThrowingFilter(): AbstractCellValueFilter {
    return {
      compiler: () => {
        throw new Error('unexpected adapter failure');
      },
    } as unknown as AbstractCellValueFilter;
  }

  booleanFilter(_field: FieldCore, _context?: IRecordQueryFilterContext): AbstractCellValueFilter {
    return this.createThrowingFilter();
  }

  numberFilter(_field: FieldCore, _context?: IRecordQueryFilterContext): AbstractCellValueFilter {
    return this.createThrowingFilter();
  }

  dateTimeFilter(_field: FieldCore, _context?: IRecordQueryFilterContext): AbstractCellValueFilter {
    return this.createThrowingFilter();
  }

  stringFilter(_field: FieldCore, _context?: IRecordQueryFilterContext): AbstractCellValueFilter {
    return this.createThrowingFilter();
  }

  jsonFilter(_field: FieldCore, _context?: IRecordQueryFilterContext): AbstractCellValueFilter {
    return this.createThrowingFilter();
  }
}

describe('filter-query invalid filter skip', () => {
  it('skips filter item with invalid operator instead of throwing', () => {
    const numberField = createNumberField('fld_num', 'num_col');
    const filter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: numberField.id,
          operator: 'contains',
          value: 'whatever',
        },
      ],
    } as unknown as IFilter;

    const qb = knexBuilder(mainTableAlias);
    const filterQuery = new FilterQueryPostgres(
      qb,
      { [numberField.id]: numberField },
      filter,
      undefined,
      dbProviderStub
    );

    expect(() => filterQuery.appendQueryBuilder()).not.toThrow();
    expect(qb.toQuery()).not.toContain('num_col');
  });

  it('preserves valid filter items alongside skipped invalid ones', () => {
    const numberField = createNumberField('fld_num', 'num_col');
    const textField = createTextField('fld_text', 'text_col');
    const filter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: numberField.id,
          operator: 'contains',
          value: 'whatever',
        },
        {
          fieldId: textField.id,
          operator: 'contains',
          value: 'hello',
        },
      ],
    } as unknown as IFilter;

    const qb = knexBuilder(mainTableAlias);
    const filterQuery = new FilterQueryPostgres(
      qb,
      { [numberField.id]: numberField, [textField.id]: textField },
      filter,
      undefined,
      dbProviderStub
    );

    expect(() => filterQuery.appendQueryBuilder()).not.toThrow();
    const sql = qb.toQuery();
    expect(sql).toContain('text_col');
    expect(sql).not.toContain('num_col');
  });

  it('keeps filter items keyed by field name when fields map supports name keys', () => {
    const textField = createTextField('fld_text_name', 'text_name_col', 'Display Name');
    const filter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: textField.name,
          operator: 'contains',
          value: 'hello',
        },
      ],
    } as unknown as IFilter;

    const qb = knexBuilder(mainTableAlias);
    const filterQuery = new FilterQueryPostgres(
      qb,
      { [textField.id]: textField, [textField.name]: textField },
      filter,
      undefined,
      dbProviderStub
    );

    expect(() => filterQuery.appendQueryBuilder()).not.toThrow();
    expect(qb.toQuery()).toContain('text_name_col');
  });

  it('skips filter item with invalid sub-operator mode instead of throwing', () => {
    const dateField = createDateField('fld_date', 'date_col');
    const filter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateField.id,
          operator: 'isWithIn',
          value: { mode: 'invalidMode', exactDate: null, timeZone: 'UTC' },
        },
      ],
    } as unknown as IFilter;

    const qb = knexBuilder(mainTableAlias);
    const filterQuery = new FilterQueryPostgres(
      qb,
      { [dateField.id]: dateField },
      filter,
      undefined,
      dbProviderStub
    );

    expect(() => filterQuery.appendQueryBuilder()).not.toThrow();
    expect(qb.toQuery()).not.toContain('date_col');
  });

  it('skips filter item whose value shape fails inside the adapter compiler', () => {
    const dateField = createDateField('fld_date_shape', 'date_shape_col');
    // value is a string, but isWithIn requires an object { mode, ... }
    const filter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateField.id,
          operator: 'isWithIn',
          value: 'today',
        },
      ],
    } as unknown as IFilter;

    const qb = knexBuilder(mainTableAlias).select('id');
    const filterQuery = new FilterQueryPostgres(
      qb,
      { [dateField.id]: dateField },
      filter,
      undefined,
      dbProviderStub
    );

    expect(() => filterQuery.appendQueryBuilder()).not.toThrow();
    expect(() => qb.toQuery()).not.toThrow();
  });

  it('rethrows non-user compiler errors instead of swallowing them', () => {
    const numberField = createNumberField('fld_num_system', 'num_system_col');
    const filter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: numberField.id,
          operator: 'is',
          value: 1,
        },
      ],
    } as unknown as IFilter;

    const qb = knexBuilder(mainTableAlias).select('id');
    const filterQuery = new ThrowingFilterQuery(
      qb,
      { [numberField.id]: numberField },
      filter,
      undefined,
      dbProviderStub
    );

    expect(() => filterQuery.appendQueryBuilder()).not.toThrow();
    expect(() => qb.toQuery()).toThrow();
  });

  it('rethrows field-reference context errors instead of skipping them', () => {
    const textField = createTextField('fld_text_ref_context', 'text_ref_context_col');
    const refField = createTextField('fld_ref_context', 'ref_context_col');
    const filter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: textField.id,
          operator: 'is',
          value: { type: 'field', fieldId: refField.id },
        },
      ],
    } as unknown as IFilter;

    const qb = knexBuilder(mainTableAlias).select('id');
    const filterQuery = new FilterQueryPostgres(
      qb,
      { [textField.id]: textField, [refField.id]: refField },
      filter,
      undefined,
      dbProviderStub
    );

    expect(() => filterQuery.appendQueryBuilder()).not.toThrow();
    expect(() => qb.toQuery()).toThrow('not available for reference comparisons');
  });
});
