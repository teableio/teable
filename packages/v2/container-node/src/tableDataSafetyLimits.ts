import type { TableDataSafetyLimitConfig } from '@teable/v2-core';

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const firstPositiveInteger = (...values: ReadonlyArray<string | undefined>): number | undefined => {
  for (const value of values) {
    const parsed = parsePositiveInteger(value);
    if (parsed != null) return parsed;
  }
  return undefined;
};

export const resolveTableDataSafetyLimitsFromEnv = (): TableDataSafetyLimitConfig => ({
  fieldOptions: {
    maxBytes: firstPositiveInteger(process.env.TABLE_LIMIT_FIELD_OPTIONS_MAX_BYTES),
    maxSelectChoices: firstPositiveInteger(
      process.env.TABLE_LIMIT_SELECT_CHOICES_MAX,
      process.env.MAX_SELECT_FIELD_OPTIONS_PER_FIELD
    ),
    maxSelectChoiceNameLength: firstPositiveInteger(
      process.env.TABLE_LIMIT_SELECT_CHOICE_NAME_MAX_LENGTH
    ),
    maxSelectDefaultValues: firstPositiveInteger(process.env.TABLE_LIMIT_SELECT_DEFAULT_VALUES_MAX),
  },
  recordValues: {
    maxCellValueBytes: firstPositiveInteger(process.env.TABLE_LIMIT_CELL_VALUE_MAX_BYTES),
    maxRecordFieldsBytes: firstPositiveInteger(process.env.TABLE_LIMIT_RECORD_FIELDS_MAX_BYTES),
    maxRecordsPerMutation: firstPositiveInteger(process.env.TABLE_LIMIT_RECORDS_PER_MUTATION_MAX),
  },
  computed: {
    maxComputedCellValueBytes: firstPositiveInteger(
      process.env.TABLE_LIMIT_COMPUTED_CELL_VALUE_MAX_BYTES
    ),
    maxFormulaLength: firstPositiveInteger(process.env.TABLE_LIMIT_FORMULA_MAX_LENGTH),
  },
  tableSchema: {
    maxTablesPerBase: firstPositiveInteger(process.env.TABLE_LIMIT_TABLES_PER_BASE_MAX),
    maxFieldsPerTable: firstPositiveInteger(
      process.env.TABLE_LIMIT_FIELDS_PER_TABLE_MAX,
      process.env.MAX_TABLE_FIELDS_PER_TABLE
    ),
    maxViewsPerTable: firstPositiveInteger(process.env.TABLE_LIMIT_VIEWS_PER_TABLE_MAX),
    maxCreateTableFields: firstPositiveInteger(process.env.TABLE_LIMIT_CREATE_TABLE_FIELDS_MAX),
    maxCreateTableViews: firstPositiveInteger(process.env.TABLE_LIMIT_CREATE_TABLE_VIEWS_MAX),
    maxCreateTableRecords: firstPositiveInteger(process.env.TABLE_LIMIT_CREATE_TABLE_RECORDS_MAX),
    maxRowsPerTable: firstPositiveInteger(process.env.TABLE_LIMIT_RECORDS_PER_TABLE_MAX),
  },
  viewConfig: {
    maxFilterItems: firstPositiveInteger(process.env.TABLE_LIMIT_VIEW_FILTER_ITEMS_MAX),
    maxFilterDepth: firstPositiveInteger(process.env.TABLE_LIMIT_VIEW_FILTER_DEPTH_MAX),
    maxSortItems: firstPositiveInteger(process.env.TABLE_LIMIT_VIEW_SORT_ITEMS_MAX),
    maxGroupItems: firstPositiveInteger(process.env.TABLE_LIMIT_VIEW_GROUP_ITEMS_MAX),
    maxOptionsBytes: firstPositiveInteger(process.env.TABLE_LIMIT_VIEW_OPTIONS_MAX_BYTES),
  },
  displayText: {
    maxNameLength: firstPositiveInteger(process.env.TABLE_LIMIT_NAME_MAX_LENGTH),
    maxDescriptionLength: firstPositiveInteger(process.env.TABLE_LIMIT_DESCRIPTION_MAX_LENGTH),
  },
});
