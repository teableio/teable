export enum RollupFunc {
  Count = 'count',
  Sum = 'sum',
  Average = 'avg',
  Min = 'min',
  Max = 'max',
}

export interface IStatisticFieldItem {
  column: string;
  rollup: RollupFunc;
}
