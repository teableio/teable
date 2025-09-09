import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Separator,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useBaseQueryData } from '../../../../hooks/useBaseQueryData';
import { useFilterNumberColumns } from '../../../../hooks/useFilterNumberColumns';
import type { IComboConfig, IComboType } from '../../../../types';
import { ComboXAxisDisplayEditor } from '../common/ComboXAxisDisplayEditor';
import { ComboYAxisDisplayEditor } from '../common/ComboYAisxDisplayEditor';
import { ConfigItem } from '../common/ConfigItem';
import { GoalLineEditor } from '../common/GoalLineEditor';
import { PaddingEditor } from '../common/PaddingEditor';
import { SwitchEditor } from '../common/SwitchEditor';
import { ComboXAxisEditor } from './ComboXAxisEditor';
import { ComboYAxisEditor } from './ComboYAxisEditor';
import type { ComboYAxis } from './utils';
import { getComboXAxisDefaultDisplay, getComboYAxisDefaultDisplay } from './utils';

export const ComboForm = (props: {
  type: IComboType;
  config: IComboConfig;
  onChange: (config: IComboConfig) => void;
}) => {
  const { type, config, onChange } = props;
  const { t } = useTranslation('chart');
  const baseQueryData = useBaseQueryData();
  const xColumns = baseQueryData?.columns ?? [];
  const yColumns = useFilterNumberColumns(baseQueryData?.columns);
  const selectedXColumns = config.xAxis?.map((x) => x.column) ?? [];
  const selectedYColumns = config.yAxis?.map((y) => y.column) ?? [];

  const canAddXColumns = xColumns.filter((v) => !selectedXColumns.includes(v.column));
  const canAddYColumns = yColumns.filter((v) => !selectedYColumns.includes(v.column));
  const onChangeXAxis = (xAxisItem: ComboYAxis, index: number) => {
    const newXAxis = config.xAxis ? [...config.xAxis!] : [];
    newXAxis[index] = xAxisItem;
    onChange({
      ...config,
      xAxis: newXAxis,
    });
  };

  const onChangeYAxis = (yAxisItem: ComboYAxis, index: number) => {
    const newYAxis = config.yAxis ? [...config.yAxis!] : [];
    newYAxis[index] = yAxisItem;
    onChange({
      ...config,
      yAxis: newYAxis,
    });
  };

  const onAddXAxis = (column: string) => {
    const newItem = {
      column: column,
      display: getComboXAxisDefaultDisplay(type),
    };
    onChange({
      ...config,
      xAxis: config.xAxis ? [...config.xAxis, newItem] : [newItem],
    });
  };

  const onAddYAxis = (column: string) => {
    const newItem = {
      column: column,
      display: getComboYAxisDefaultDisplay(type),
    };
    onChange({
      ...config,
      yAxis: config.yAxis ? [...config.yAxis, newItem] : [newItem],
    });
  };

  const onDeleteXAxis = (index: number) => {
    const newXAxis = config.xAxis ? [...config.xAxis] : [];
    newXAxis.splice(index, 1);
    onChange({
      ...config,
      xAxis: newXAxis,
    });
  };

  const onDeleteYAxis = (index: number) => {
    const newYAxis = config.yAxis ? [...config.yAxis] : [];
    newYAxis.splice(index, 1);
    onChange({
      ...config,
      yAxis: newYAxis,
    });
  };

  const xAxisLen = config.xAxis?.length ?? 0;
  const yAxisLen = config.yAxis?.length ?? 0;
  const hiddenDeleteXAxisBtn = xAxisLen && xAxisLen < 2;
  const hiddenDeleteYAxisBtn = yAxisLen && yAxisLen < 2;
  // TODO: Support multiple x-axis
  const hiddenAddXAxisBtn = canAddXColumns.length === 0 || xAxisLen === 1;
  const hiddenAddYAxisBtn = canAddYColumns.length === 0;

  return (
    <div className="space-y-6">
      <ConfigItem label={t('form.combo.xAxis.label')}>
        <div>
          <div className="space-y-2">
            {config.xAxis?.map((xAxisItem, index) => (
              <ComboXAxisEditor
                key={xAxisItem.column}
                value={xAxisItem}
                selectedColumns={selectedXColumns}
                onChange={(xAxisItem) => {
                  onChangeXAxis(xAxisItem, index);
                }}
                onDelete={() => onDeleteXAxis(index)}
                hiddenDelete={!!hiddenDeleteXAxisBtn}
                hiddenSettings
              />
            ))}
          </div>
          {!hiddenAddXAxisBtn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="mt-2 block h-auto p-0" variant="link">
                  {t('form.combo.addXAxis')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {canAddXColumns.map((column) => (
                  <DropdownMenuItem
                    key={column.column}
                    onClick={() => {
                      onAddXAxis(column.column);
                    }}
                  >
                    {column.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ConfigItem>
      <ConfigItem label={t('form.combo.yAxis.label')}>
        <div>
          <div className="space-y-3">
            {config.yAxis?.map((yAxisItem, index) => (
              <ComboYAxisEditor
                key={yAxisItem.column}
                value={yAxisItem}
                selectedColumns={selectedYColumns}
                onChange={(yAxisItem) => {
                  onChangeYAxis(yAxisItem, index);
                }}
                onDelete={() => onDeleteYAxis(index)}
                hiddenDelete={!!hiddenDeleteYAxisBtn}
              />
            ))}
          </div>
          {!hiddenAddYAxisBtn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="mt-2 block h-auto p-0" variant="link">
                  {t('form.combo.addYAxis')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {canAddYColumns.map((column) => (
                  <DropdownMenuItem
                    key={column.column}
                    onClick={() => {
                      onAddYAxis(column.column);
                    }}
                  >
                    {column.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ConfigItem>
      <div>
        <Separator />
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger>{t('form.combo.xDisplay.label')}</AccordionTrigger>
            <AccordionContent>
              <ComboXAxisDisplayEditor
                value={config.xAxisDisplay}
                onChange={(val) => {
                  onChange({
                    ...config,
                    xAxisDisplay: val,
                  });
                }}
              />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>{t('form.combo.yDisplay.label')}</AccordionTrigger>
            <AccordionContent>
              <ComboYAxisDisplayEditor
                value={config.yAxisDisplay}
                onChange={(val) => {
                  onChange({
                    ...config,
                    yAxisDisplay: val,
                  });
                }}
              />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger>{t('form.padding.label')}</AccordionTrigger>
            <AccordionContent>
              <PaddingEditor
                value={config.padding}
                onChange={(val) => {
                  onChange({
                    ...config,
                    padding: val,
                  });
                }}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <SwitchEditor
        label={t('form.showLabel')}
        value={config.showLabel}
        onChange={(val) => {
          onChange({
            ...config,
            showLabel: val,
          });
        }}
      />
      <GoalLineEditor
        value={config.goalLine}
        onChange={(val) => {
          onChange({
            ...config,
            goalLine: val,
          });
        }}
      />
    </div>
  );
};
