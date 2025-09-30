/* eslint-disable @typescript-eslint/naming-convention */
import {
  CellValueType,
  CheckboxFieldCore,
  DateFieldCore,
  DateFormattingPreset,
  DriverClient,
  FieldType,
  NumberFieldCore,
  SingleLineTextFieldCore,
  TimeFormatting,
  filterSchema,
  is,
} from '@teable/core';
import type { FieldCore, IFilter } from '@teable/core';
import knex from 'knex';
import type { IDbProvider } from '../../db.provider.interface';
import { FilterQueryPostgres } from '../postgres/filter-query.postgres';

type FieldPair = {
  label: string;
  field: FieldCore;
  reference: FieldCore;
  expectedSql: RegExp;
};

const knexBuilder = knex({ client: 'pg' });

const dbProviderStub = { driver: DriverClient.Pg } as unknown as IDbProvider;

function assignBaseField<T extends FieldCore>(
  field: T,
  params: {
    id: string;
    dbFieldName: string;
    type: FieldType;
    cellValueType: CellValueType;
    options: T['options'];
  }
): T {
  field.id = params.id;
  field.name = params.id;
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

function createTextField(id: string, dbFieldName: string): SingleLineTextFieldCore {
  return assignBaseField(new SingleLineTextFieldCore(), {
    id,
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

function createCheckboxField(id: string, dbFieldName: string): CheckboxFieldCore {
  return assignBaseField(new CheckboxFieldCore(), {
    id,
    dbFieldName,
    type: FieldType.Checkbox,
    cellValueType: CellValueType.Boolean,
    options: CheckboxFieldCore.defaultOptions(),
  });
}

const cases: FieldPair[] = [
  {
    label: 'number field',
    field: createNumberField('fld_number', 'number_col'),
    reference: createNumberField('fld_number_ref', 'number_ref'),
    expectedSql: /"main"."number_col" = "main"."number_ref"/i,
  },
  {
    label: 'single line text field',
    field: createTextField('fld_text', 'text_col'),
    reference: createTextField('fld_text_ref', 'text_ref'),
    expectedSql: /LOWER\("main"\."text_col"\) = LOWER\("main"\."text_ref"\)/i,
  },
  {
    label: 'date field',
    field: createDateField('fld_date', 'date_col'),
    reference: createDateField('fld_date_ref', 'date_ref'),
    expectedSql:
      /DATE_TRUNC\('day', \("main"\."date_col"\) AT TIME ZONE 'UTC'\) = DATE_TRUNC\('day', \("main"\."date_ref"\) AT TIME ZONE 'UTC'\)/,
  },
  {
    label: 'checkbox field',
    field: createCheckboxField('fld_checkbox', 'checkbox_col'),
    reference: createCheckboxField('fld_checkbox_ref', 'checkbox_ref'),
    expectedSql: /"main"."checkbox_col" = "main"."checkbox_ref"/i,
  },
];

describe('field reference filters', () => {
  it.each(cases)('supports field reference for %s', ({ field, reference, expectedSql }) => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: field.id,
          operator: is.value,
          value: { type: 'field', fieldId: reference.id },
        },
      ],
    } as const;

    const parseResult = filterSchema.safeParse(filter);
    expect(parseResult.success).toBe(true);

    const qb = knexBuilder('main_table as main');

    const selectionEntries: [string, string][] = [
      [field.id, `"main"."${field.dbFieldName}"`],
      [reference.id, `"main"."${reference.dbFieldName}"`],
    ];

    const selectionMap = new Map(selectionEntries);
    const filterQuery = new FilterQueryPostgres(
      qb,
      {
        [field.id]: field,
        [reference.id]: reference,
      },
      filter,
      undefined,
      dbProviderStub,
      {
        selectionMap,
        fieldReferenceSelectionMap: new Map(selectionEntries),
        fieldReferenceFieldMap: new Map<FieldCore['id'], FieldCore>([
          [field.id, field],
          [reference.id, reference],
        ]),
      }
    );

    expect(() => filterQuery.appendQueryBuilder()).not.toThrow();

    const sql = qb.toQuery().replace(/\s+/g, ' ');
    expect(sql).toMatch(expectedSql);
  });
});
