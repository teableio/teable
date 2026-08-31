import { sdkErrorI18nKeys, type SdkErrorI18nKey } from '@teable/i18n-keys';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from './DomainError';

export type TableDataSafetyLimitConfig = {
  readonly fieldOptions?: {
    readonly maxBytes?: number;
    readonly maxSelectChoices?: number;
    readonly maxSelectChoiceNameLength?: number;
    readonly maxSelectDefaultValues?: number;
  };
  readonly recordValues?: {
    readonly maxCellValueBytes?: number;
    readonly maxRecordFieldsBytes?: number;
    readonly maxRecordsPerMutation?: number;
  };
  readonly computed?: {
    readonly maxComputedCellValueBytes?: number;
    readonly maxFormulaLength?: number;
  };
  readonly tableSchema?: {
    readonly maxTablesPerBase?: number;
    readonly maxFieldsPerTable?: number;
    readonly maxViewsPerTable?: number;
    readonly maxCreateTableFields?: number;
    readonly maxCreateTableViews?: number;
    readonly maxCreateTableRecords?: number;
    readonly maxRowsPerTable?: number;
  };
  readonly viewConfig?: {
    readonly maxFilterItems?: number;
    readonly maxFilterDepth?: number;
    readonly maxSortItems?: number;
    readonly maxGroupItems?: number;
    readonly maxOptionsBytes?: number;
  };
  readonly displayText?: {
    readonly maxNameLength?: number;
    readonly maxDescriptionLength?: number;
  };
};

export type ResolvedTableDataSafetyLimitConfig = {
  readonly fieldOptions: Required<NonNullable<TableDataSafetyLimitConfig['fieldOptions']>>;
  readonly recordValues: Required<NonNullable<TableDataSafetyLimitConfig['recordValues']>>;
  readonly computed: Required<NonNullable<TableDataSafetyLimitConfig['computed']>>;
  readonly tableSchema: Required<
    Omit<NonNullable<TableDataSafetyLimitConfig['tableSchema']>, 'maxRowsPerTable'>
  > & {
    readonly maxRowsPerTable?: number;
  };
  readonly viewConfig: Required<NonNullable<TableDataSafetyLimitConfig['viewConfig']>>;
  readonly displayText: Required<NonNullable<TableDataSafetyLimitConfig['displayText']>>;
};

export const DEFAULT_TABLE_DATA_SAFETY_LIMITS: ResolvedTableDataSafetyLimitConfig = {
  fieldOptions: {
    maxBytes: 262_144,
    maxSelectChoices: 1_000,
    maxSelectChoiceNameLength: 1_000,
    maxSelectDefaultValues: 100,
  },
  recordValues: {
    maxCellValueBytes: 262_144,
    maxRecordFieldsBytes: 1_048_576,
    maxRecordsPerMutation: 20_000,
  },
  computed: {
    maxComputedCellValueBytes: 262_144,
    maxFormulaLength: 8_192,
  },
  tableSchema: {
    maxTablesPerBase: 1_000,
    maxFieldsPerTable: 500,
    maxViewsPerTable: 100,
    maxCreateTableFields: 1_000,
    maxCreateTableViews: 20,
    maxCreateTableRecords: 20_000,
  },
  viewConfig: {
    maxFilterItems: 100,
    maxFilterDepth: 5,
    maxSortItems: 20,
    maxGroupItems: 3,
    maxOptionsBytes: 262_144,
  },
  displayText: {
    maxNameLength: 100,
    maxDescriptionLength: 2_000,
  },
};

const mergeGroup = <T extends Record<string, unknown>>(
  defaults: T,
  override: Partial<T> | undefined
): T => {
  const definedOverride = Object.fromEntries(
    Object.entries(override ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
  return { ...defaults, ...definedOverride };
};

export const resolveTableDataSafetyLimits = (
  config?: TableDataSafetyLimitConfig
): ResolvedTableDataSafetyLimitConfig => ({
  fieldOptions: mergeGroup(DEFAULT_TABLE_DATA_SAFETY_LIMITS.fieldOptions, config?.fieldOptions),
  recordValues: mergeGroup(DEFAULT_TABLE_DATA_SAFETY_LIMITS.recordValues, config?.recordValues),
  computed: mergeGroup(DEFAULT_TABLE_DATA_SAFETY_LIMITS.computed, config?.computed),
  tableSchema: mergeGroup(DEFAULT_TABLE_DATA_SAFETY_LIMITS.tableSchema, config?.tableSchema),
  viewConfig: mergeGroup(DEFAULT_TABLE_DATA_SAFETY_LIMITS.viewConfig, config?.viewConfig),
  displayText: mergeGroup(DEFAULT_TABLE_DATA_SAFETY_LIMITS.displayText, config?.displayText),
});

export const mergeTableDataSafetyLimitConfig = (
  base: TableDataSafetyLimitConfig | undefined,
  override: TableDataSafetyLimitConfig | undefined
): TableDataSafetyLimitConfig | undefined => {
  if (!base && !override) return undefined;
  return {
    fieldOptions: { ...(base?.fieldOptions ?? {}), ...(override?.fieldOptions ?? {}) },
    recordValues: { ...(base?.recordValues ?? {}), ...(override?.recordValues ?? {}) },
    computed: { ...(base?.computed ?? {}), ...(override?.computed ?? {}) },
    tableSchema: { ...(base?.tableSchema ?? {}), ...(override?.tableSchema ?? {}) },
    viewConfig: { ...(base?.viewConfig ?? {}), ...(override?.viewConfig ?? {}) },
    displayText: { ...(base?.displayText ?? {}), ...(override?.displayText ?? {}) },
  };
};

// Hot path: called per record AND per cell on bulk writes. Byte counting via a
// shared encoder (no per-call allocation); Node's Buffer.byteLength counts
// without materializing the encoded copy at all.
const sharedJsonEncoder = new TextEncoder();
const measureUtf8Bytes: (json: string) => number =
  typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function'
    ? (json) => Buffer.byteLength(json, 'utf8')
    : (json) => sharedJsonEncoder.encode(json).byteLength;

export const measureJsonBytes = (value: unknown): number => {
  const json = JSON.stringify(value);
  return measureUtf8Bytes(json === undefined ? 'undefined' : json);
};

export interface ITableDataSafetyLimitError {
  readonly code: string;
  readonly i18nKey: SdkErrorI18nKey;
}

/**
 * The vocabulary of table data safety limit errors. Each entry pairs the
 * machine-readable domain code with the user-facing message key, so throw
 * sites reference one entry and the two can never drift apart. Every message
 * interpolates exactly `{{max}}`.
 */
export const tableDataSafetyLimitErrors = {
  fieldOptionsMaxBytes: {
    code: 'validation.limit.field_options_max_bytes',
    i18nKey: sdkErrorI18nKeys.limit.fieldOptionsMaxBytes,
  },
  selectChoicesMax: {
    code: 'validation.limit.select_choices_max',
    i18nKey: sdkErrorI18nKeys.limit.selectChoicesMax,
  },
  selectChoiceNameMaxLength: {
    code: 'validation.limit.select_choice_name_max_length',
    i18nKey: sdkErrorI18nKeys.limit.selectChoiceNameMaxLength,
  },
  selectDefaultValuesMax: {
    code: 'validation.limit.select_default_values_max',
    i18nKey: sdkErrorI18nKeys.limit.selectDefaultValuesMax,
  },
  cellValueMaxBytes: {
    code: 'validation.limit.cell_value_max_bytes',
    i18nKey: sdkErrorI18nKeys.limit.cellValueMaxBytes,
  },
  recordFieldsMaxBytes: {
    code: 'validation.limit.record_fields_max_bytes',
    i18nKey: sdkErrorI18nKeys.limit.recordFieldsMaxBytes,
  },
  recordsPerMutationMax: {
    code: 'validation.limit.records_per_mutation_max',
    i18nKey: sdkErrorI18nKeys.limit.recordsPerMutationMax,
  },
  computedCellValueMaxBytes: {
    code: 'validation.limit.computed_cell_value_max_bytes',
    i18nKey: sdkErrorI18nKeys.limit.computedCellValueMaxBytes,
  },
  formulaMaxLength: {
    code: 'validation.limit.formula_max_length',
    i18nKey: sdkErrorI18nKeys.limit.formulaMaxLength,
  },
  tablesPerBaseMax: {
    code: 'validation.limit.tables_per_base_max',
    i18nKey: sdkErrorI18nKeys.limit.tablesPerBaseMax,
  },
  fieldsPerTableMax: {
    code: 'validation.limit.fields_per_table_max',
    i18nKey: sdkErrorI18nKeys.limit.fieldsPerTableMax,
  },
  rowsPerTableMax: {
    code: 'validation.limit.rows_per_table_max',
    i18nKey: sdkErrorI18nKeys.limit.rowsPerTableMax,
  },
  viewsPerTableMax: {
    code: 'validation.limit.views_per_table_max',
    i18nKey: sdkErrorI18nKeys.limit.viewsPerTableMax,
  },
  createTableFieldsMax: {
    code: 'validation.limit.create_table_fields_max',
    i18nKey: sdkErrorI18nKeys.limit.createTableFieldsMax,
  },
  createTableViewsMax: {
    code: 'validation.limit.create_table_views_max',
    i18nKey: sdkErrorI18nKeys.limit.createTableViewsMax,
  },
  createTableRecordsMax: {
    code: 'validation.limit.create_table_records_max',
    i18nKey: sdkErrorI18nKeys.limit.createTableRecordsMax,
  },
  viewFilterItemsMax: {
    code: 'validation.limit.view_filter_items_max',
    i18nKey: sdkErrorI18nKeys.limit.viewFilterItemsMax,
  },
  viewFilterDepthMax: {
    code: 'validation.limit.view_filter_depth_max',
    i18nKey: sdkErrorI18nKeys.limit.viewFilterDepthMax,
  },
  viewSortItemsMax: {
    code: 'validation.limit.view_sort_items_max',
    i18nKey: sdkErrorI18nKeys.limit.viewSortItemsMax,
  },
  viewGroupItemsMax: {
    code: 'validation.limit.view_group_items_max',
    i18nKey: sdkErrorI18nKeys.limit.viewGroupItemsMax,
  },
  viewOptionsMaxBytes: {
    code: 'validation.limit.view_options_max_bytes',
    i18nKey: sdkErrorI18nKeys.limit.viewOptionsMaxBytes,
  },
  nameMaxLength: {
    code: 'validation.limit.name_max_length',
    i18nKey: sdkErrorI18nKeys.limit.nameMaxLength,
  },
  descriptionMaxLength: {
    code: 'validation.limit.description_max_length',
    i18nKey: sdkErrorI18nKeys.limit.descriptionMaxLength,
  },
} as const satisfies Record<string, ITableDataSafetyLimitError>;

export const ensureWithinTableDataSafetyLimit = (
  limit: ITableDataSafetyLimitError,
  attempted: number,
  max: number | undefined,
  details: Readonly<Record<string, unknown>> = {}
): Result<void, DomainError> => {
  if (max == null || attempted <= max) {
    return ok(undefined);
  }

  return err(
    domainError.validation({
      code: limit.code,
      message: `Table data safety limit exceeded: ${limit.code}`,
      details: {
        ...details,
        attempted,
        max,
      },
      localization: { i18nKey: limit.i18nKey, context: { max } },
    })
  );
};
