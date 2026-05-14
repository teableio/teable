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
    maxSelectChoiceNameLength: 100,
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

export const measureJsonBytes = (value: unknown): number => {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json === undefined ? 'undefined' : json).byteLength;
};

export const ensureWithinTableDataSafetyLimit = (
  code: string,
  attempted: number,
  max: number | undefined,
  details: Readonly<Record<string, unknown>> = {}
): Result<void, DomainError> => {
  if (max == null || attempted <= max) {
    return ok(undefined);
  }

  return err(
    domainError.validation({
      code,
      message: `Table data safety limit exceeded: ${code}`,
      details: {
        ...details,
        attempted,
        max,
      },
    })
  );
};
