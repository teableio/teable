import type { FormulaFunc } from './common';
import { FunctionName } from './common';
import { Sum } from './numeric';
import { Rollup } from './system';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const FUNCTIONS: Record<FunctionName, FormulaFunc> = {
  [FunctionName.Sum]: new Sum(),
  [FunctionName.Rollup]: new Rollup(),
};
