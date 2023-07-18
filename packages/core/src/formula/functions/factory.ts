import { CountAll } from './array';
import type { FormulaFunc } from './common';
import { FunctionName } from './common';
import { And } from './logical';
import { Sum } from './numeric';
import { TextAll } from './system';
import { Concatenate } from './text';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const FUNCTIONS: Record<FunctionName, FormulaFunc> = {
  [FunctionName.Sum]: new Sum(),
  [FunctionName.TextAll]: new TextAll(),
  [FunctionName.Concatenate]: new Concatenate(),
  [FunctionName.CountAll]: new CountAll(),
  [FunctionName.And]: new And(),
};
