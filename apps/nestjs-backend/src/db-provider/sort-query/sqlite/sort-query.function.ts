import { AbstractSortFunction } from '../function/sort-function.abstract';

export class SortFunctionSqlite extends AbstractSortFunction {
  generateOrderByCase(keys: string[]): string {
    const cases = keys.map((key, index) => `WHEN '${key}' THEN ${index + 1}`).join(' ');
    return `CASE ?? ${cases} ELSE -1 END`;
  }
}
