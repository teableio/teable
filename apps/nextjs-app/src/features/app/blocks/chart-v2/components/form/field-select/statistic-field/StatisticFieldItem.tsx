import { CellValueType } from '@teable/core';
import { Trash2 } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { FieldSelect } from '../FieldSelect';
import { StatisticFunSelect } from './StatisticFunSelect';
import type { IStatisticFieldItem, RollupFunc } from './types';

interface IStaticFieldItemProps {
  allStaticFields: IStatisticFieldItem[];
  value: IStatisticFieldItem;
  onChange: (value: IStatisticFieldItem) => void;
  onDelete: () => void;
}
export const StatisticFieldItem = (props: IStaticFieldItemProps) => {
  const { allStaticFields, value, onChange, onDelete } = props;

  return (
    <div className="flex w-full gap-2">
      <FieldSelect
        selectedFields={allStaticFields.map((field) => field.column)}
        value={value?.column}
        onChange={(property: string) => {
          onChange({
            ...value,
            column: property,
          } as IStatisticFieldItem);
        }}
        className="w-full"
        allowCellValueType={[CellValueType.Number]}
      />

      <StatisticFunSelect
        value={value.rollup as RollupFunc}
        onChange={(property: RollupFunc) => {
          onChange({
            ...value,
            rollup: property as RollupFunc,
          } as IStatisticFieldItem);
        }}
        className="w-full"
      />

      <Button
        variant="outline"
        onClick={onDelete}
        disabled={allStaticFields.length === 1}
        className="size-9 shrink-0 p-0"
      >
        <Trash2 className="size-4 shrink-0 text-destructive" />
      </Button>
    </div>
  );
};
