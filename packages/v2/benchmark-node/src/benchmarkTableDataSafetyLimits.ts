import type { TableDataSafetyLimitConfig } from '@teable/v2-core';

export const benchmarkTableDataSafetyLimits = {
  tableSchema: {
    maxTablesPerBase: 100_000,
    maxCreateTableFields: 1_000,
    maxFieldsPerTable: 1_000,
  },
} satisfies TableDataSafetyLimitConfig;
