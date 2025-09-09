import { Settings, X } from '@teable/icons';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { useBaseQueryData } from '../../../../hooks/useBaseQueryData';
import type { IChartBaseAxisDisplay, IComboConfig } from '../../../../types';
import { AxisDisplayBaseContent } from '../common/AxisDisplayBaseContent';
import { ColumnSelector } from '../common/ColumnSelector';

type ComboXAxis = NonNullable<IComboConfig['xAxis']>[number];

export const ComboXAxisEditor = (props: {
  value: ComboXAxis;
  selectedColumns: string[];
  onChange: (value: ComboXAxis) => void;
  onDelete: () => void;
  hiddenSettings?: boolean;
  hiddenDelete?: boolean;
}) => {
  const { value, selectedColumns, onChange, onDelete, hiddenDelete, hiddenSettings } = props;

  const baseQueryData = useBaseQueryData();
  const columns =
    baseQueryData?.columns?.filter(
      ({ column }) => column === value.column || !selectedColumns.includes(column)
    ) ?? [];

  const displayValue = value?.display;
  const onChangeDisplay = (display: IChartBaseAxisDisplay) => {
    if (!value) {
      return;
    }
    onChange({
      ...value,
      display,
    });
  };

  return (
    <div className="relative flex items-center gap-2">
      <ColumnSelector
        className="flex-1"
        value={value?.column}
        onChange={(xAxisCol) =>
          onChange({
            ...value,
            column: xAxisCol,
          })
        }
        columns={columns}
      />
      {!hiddenSettings && value?.column && displayValue && (
        <XAxisDisplayEditor value={displayValue} onChange={onChangeDisplay} />
      )}
      {!hiddenDelete && (
        <Button size="xs" variant="outline" onClick={onDelete}>
          <X />
        </Button>
      )}
    </div>
  );
};

export const XAxisDisplayEditor = (props: {
  className?: string;
  value: IChartBaseAxisDisplay;
  onChange: (value: IChartBaseAxisDisplay) => void;
}) => {
  const { value: displayValue, onChange, className } = props;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className={className} size="xs" variant={'outline'}>
          <Settings />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-64 space-y-4 overflow-auto">
        <AxisDisplayBaseContent value={displayValue} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
};
