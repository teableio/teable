import { DraggableHandle, Settings } from '@teable/icons';
import type { IBaseQueryColumn } from '@teable/openapi';
import { useIsHydrated } from '@teable/sdk';
import type { DragEndEvent } from '@teable/ui-lib';
import {
  DndKitContext,
  Droppable,
  Draggable,
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Input,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { useBaseQueryData } from '../../../../hooks/useBaseQueryData';
import type { ITableConfig } from '../../../../types';
import { sortTableColumns, tableConfigColumnsToMap } from '../../utils';
import { ConfigItem } from '../common/ConfigItem';
import { NumberInput } from '../common/NumberInput';

export const TableForm = (props: {
  config: ITableConfig;
  onChange: (config: ITableConfig) => void;
}) => {
  const { config, onChange } = props;
  const { columns: configColumns } = config;
  const queryData = useBaseQueryData();
  const columns = queryData?.columns;
  const [sortedColumns, setSortedColumns] = useState<IBaseQueryColumn[]>([]);
  const isHydrated = useIsHydrated();
  const { t } = useTranslation('chart');
  const configColumnMap = useMemo(() => tableConfigColumnsToMap(configColumns), [configColumns]);

  useEffect(() => {
    if (!columns) {
      return setSortedColumns([]);
    }
    setSortedColumns(sortTableColumns(columns, configColumnMap));
  }, [columns, configColumnMap]);

  if (!isHydrated) {
    return null;
  }

  const onDragEndHandler = async (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;

    if (!over || !sortedColumns || from === to) {
      return;
    }

    const list = [...sortedColumns];
    const [base] = list.splice(from, 1);

    list.splice(to, 0, base);

    setSortedColumns(list);

    onChange({
      ...config,
      columns: list.map((v) => configColumnMap[v.column] ?? { column: v.column }),
    });
  };

  const onWidthChange = (column: string, width?: number) => {
    if (!config.columns) {
      onChange({
        ...config,
        columns: [{ column, width }],
      });
      return;
    }
    const newColumns = config.columns.map((v) => {
      if (v.column === column) {
        return {
          ...v,
          width,
        };
      }
      return v;
    });

    onChange({
      ...config,
      columns: newColumns,
    });
  };

  const onLabelChange = (column: string, label?: string) => {
    if (!config.columns) {
      onChange({
        ...config,
        columns: [{ column, label }],
      });
      return;
    }
    const newColumns = config.columns.map((v) => {
      if (v.column === column) {
        return {
          ...v,
          label,
        };
      }
      return v;
    });

    onChange({
      ...config,
      columns: newColumns,
    });
  };

  return (
    <ConfigItem label={t('form.tableConfig')}>
      <div className="space-y-4">
        <DndKitContext onDragEnd={onDragEndHandler}>
          <Droppable items={sortedColumns.map((v) => v.column)}>
            {sortedColumns.map((column) => (
              <Draggable key={column.column} id={column.column}>
                {({ setNodeRef, attributes, listeners, style }) => (
                  <div
                    ref={setNodeRef}
                    {...attributes}
                    {...listeners}
                    style={style}
                    className="flex items-center gap-2 rounded border bg-background p-1"
                  >
                    <DraggableHandle />
                    <div className="flex-1 text-[13px]">{column.name}</div>
                    <Popover>
                      <PopoverTrigger>
                        <Button variant="ghost" size="xs">
                          <Settings />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="space-y-2">
                        <ConfigItem label={t('form.width')}>
                          <NumberInput
                            value={configColumnMap[column.column]?.width}
                            onValueChange={(val) => onWidthChange(column.column, val)}
                          />
                        </ConfigItem>
                        <ConfigItem label={t('form.label')}>
                          <LabelInput
                            value={configColumnMap[column.column]?.label}
                            onChange={(val) => onLabelChange(column.column, val)}
                          />
                        </ConfigItem>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </Draggable>
            ))}
          </Droppable>
        </DndKitContext>
      </div>
    </ConfigItem>
  );
};

const LabelInput = (props: { value?: string; onChange: (value?: string) => void }) => {
  const { value, onChange } = props;
  const [inputValue, setInputValue] = useState(value);
  return (
    <Input
      className="h-7 text-[13px]"
      value={inputValue}
      onBlur={() => inputValue !== value && onChange(inputValue)}
      onChange={(e) => setInputValue(e.target.value)}
    />
  );
};
