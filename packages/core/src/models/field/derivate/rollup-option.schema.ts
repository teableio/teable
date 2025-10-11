/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { z } from '../../../zod';
import { CellValueType } from '../constant';
import { timeZoneStringSchema, unionFormattingSchema } from '../formatting';
import { unionShowAsSchema } from '../show-as';

export const ROLLUP_FUNCTIONS = [
  'countall({values})',
  'counta({values})',
  'count({values})',
  'sum({values})',
  'average({values})',
  'max({values})',
  'min({values})',
  'and({values})',
  'or({values})',
  'xor({values})',
  'array_join({values})',
  'array_unique({values})',
  'array_compact({values})',
  'concatenate({values})',
] as const;

export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

const BASE_ROLLUP_FUNCTIONS: RollupFunction[] = [
  'countall({values})',
  'counta({values})',
  'count({values})',
  'array_join({values})',
  'array_unique({values})',
  'array_compact({values})',
  'concatenate({values})',
];

const NUMBER_ROLLUP_FUNCTIONS: RollupFunction[] = [
  'sum({values})',
  'average({values})',
  'max({values})',
  'min({values})',
];

const DATETIME_ROLLUP_FUNCTIONS: RollupFunction[] = ['max({values})', 'min({values})'];

const BOOLEAN_ROLLUP_FUNCTIONS: RollupFunction[] = [
  'and({values})',
  'or({values})',
  'xor({values})',
];

export const getRollupFunctionsByCellValueType = (
  cellValueType: CellValueType
): RollupFunction[] => {
  const allowed = new Set<RollupFunction>(BASE_ROLLUP_FUNCTIONS);

  switch (cellValueType) {
    case CellValueType.Number:
      NUMBER_ROLLUP_FUNCTIONS.forEach((fn) => allowed.add(fn));
      break;
    case CellValueType.DateTime:
      DATETIME_ROLLUP_FUNCTIONS.forEach((fn) => allowed.add(fn));
      break;
    case CellValueType.Boolean:
      BOOLEAN_ROLLUP_FUNCTIONS.forEach((fn) => allowed.add(fn));
      break;
    case CellValueType.String:
    default:
      break;
  }

  return ROLLUP_FUNCTIONS.filter((fn) => allowed.has(fn));
};

export const isRollupFunctionSupportedForCellValueType = (
  expression: RollupFunction,
  cellValueType: CellValueType
): boolean => {
  return getRollupFunctionsByCellValueType(cellValueType).includes(expression);
};

export const rollupFieldOptionsSchema = z.object({
  expression: z.enum(ROLLUP_FUNCTIONS),
  timeZone: timeZoneStringSchema.optional(),
  formatting: unionFormattingSchema.optional(),
  showAs: unionShowAsSchema.optional(),
});

export type IRollupFieldOptions = z.infer<typeof rollupFieldOptionsSchema>;
