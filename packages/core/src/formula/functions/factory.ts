import type { FormulaFunc } from './common';
import { FunctionName } from './common';
import { Sum } from './numeric';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const FUNCTIONS: Record<FunctionName, FormulaFunc> = {
  [FunctionName.Sum]: new Sum(),
};
