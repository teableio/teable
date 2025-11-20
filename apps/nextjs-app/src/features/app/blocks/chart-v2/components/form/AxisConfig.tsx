import { CellValueType, FieldType } from '@teable/core';
import type { ITableQuery, IStatisticFieldItem } from '@teable/openapi';
import {
  Label,
  Separator,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo } from 'react';
import { ChartType } from '../../chart';
import { useFields, useStorage } from '../../hooks';
import { ColumnSelect } from './ColumnSelect';
import { StatisticFieldSelect } from './field-select';
import { FormLabel } from './FormLabel';
import { TabSelect } from './TabSelect';

export const AxisConfig = () => {
  const { t } = useTranslation('chart');
  const { storage, updateStorageByPath } = useStorage();
  const { fields } = useFields();
  const { query, chartType } = storage;
  const { xAxis, seriesArray, orderBy, groupBy } = (query || {}) as ITableQuery;

  const pieChartType = [ChartType.Pie, ChartType.DonutChart].includes(chartType);
  const countAll = seriesArray === 'COUNTA';

  const displayGroupBy = useMemo(() => {
    if (pieChartType) {
      return false;
    }
    if (!countAll && seriesArray?.length > 1) {
      return false;
    }

    if (!groupBy) {
      return false;
    }
    return true;
  }, [countAll, groupBy, pieChartType, seriesArray?.length]);

  const groupBySwitchVisible = useMemo(() => {
    return ![ChartType.Pie, ChartType.DonutChart].includes(chartType);
  }, [chartType]);

  const defaultField = useMemo(() => {
    return fields?.at(0)?.id || null;
  }, [fields]);

  const groupAggregationHandler = useCallback(
    (checked: boolean) => {
      if (checked) {
        updateStorageByPath(`query.groupBy`, defaultField);
      } else {
        updateStorageByPath(`query.groupBy`, null);
      }
    },
    [updateStorageByPath, defaultField]
  );

  const countFields = useMemo(() => {
    return fields?.filter((f) => f.cellValueType === CellValueType.Number);
  }, [fields]);

  return (
    <div className="flex flex-col gap-2">
      <FormLabel
        label={t('chartV2.form.axisConfig.xAxis')}
        labelClassName="text-base font-semibold"
        className="gap-4"
      >
        <FormLabel label={t('chartV2.form.axisConfig.field')}>
          <ColumnSelect
            key={xAxis}
            value={xAxis}
            onChange={(value) => {
              updateStorageByPath(`query.xAxis`, value);
            }}
          />
        </FormLabel>

        <FormLabel label={t('chartV2.form.order.orderBy.title')}>
          <TabSelect
            value={orderBy?.on ?? null}
            options={[
              { label: t('chartV2.form.order.orderBy.byXAxis'), value: 'xAxis' },
              { label: t('chartV2.form.order.orderBy.byYAxis'), value: 'yAxis' },
            ]}
            onChange={(value) => {
              updateStorageByPath(`query.orderBy.on`, value);
            }}
          />
        </FormLabel>

        <FormLabel label={t('chartV2.form.order.orderType.title')}>
          <TabSelect
            value={orderBy?.order}
            options={[
              { label: t('chartV2.form.order.orderType.asc'), value: 'asc' },
              { label: t('chartV2.form.order.orderType.desc'), value: 'desc' },
            ]}
            onChange={(value) => {
              updateStorageByPath(`query.orderBy.order`, value);
            }}
          />
        </FormLabel>
      </FormLabel>

      <Separator />

      {/* y axis */}
      <FormLabel
        label={t('chartV2.form.axisConfig.yAxis')}
        labelClassName="text-base font-semibold"
        className="gap-4"
      >
        <FormLabel label={t('chartV2.form.axisConfig.Statistic')}>
          <Tabs
            defaultValue="totalRecords"
            className="w-full"
            value={countAll ? 'totalRecords' : 'fieldValue'}
          >
            <TabsList className="w-full">
              <TabsTrigger
                value="totalRecords"
                className="w-full"
                onClick={() => {
                  updateStorageByPath(`query.seriesArray`, 'COUNTA');
                }}
              >
                {t('chartV2.form.axisConfig.totalRecords')}
              </TabsTrigger>
              <TabsTrigger
                value="fieldValue"
                className="w-full"
                onClick={() => {
                  if (countFields.length > 0) {
                    updateStorageByPath(`query.seriesArray`, [
                      {
                        fieldId: countFields[0].id,
                        rollup: 'sum',
                      },
                    ]);
                  } else {
                    updateStorageByPath(`query.seriesArray`, []);
                  }
                }}
              >
                {t('chartV2.form.axisConfig.fieldValue')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="totalRecords"></TabsContent>
            <TabsContent value="fieldValue">
              {!countAll && (
                <StatisticFieldSelect
                  value={seriesArray as unknown as IStatisticFieldItem[]}
                  onChange={(value) => {
                    updateStorageByPath(`query.seriesArray`, value);
                  }}
                />
              )}
              {countFields?.length === 0 && (
                <div className="text-sm text-red-500">
                  {t('chartV2.form.axisConfig.noCountFields')}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </FormLabel>

        {groupBySwitchVisible && (
          <div className="flex items-center justify-between">
            <Label htmlFor="groupAggregation">
              {t('chartV2.form.axisConfig.groupAggregation')}
            </Label>
            <Switch
              id="groupAggregation"
              onCheckedChange={groupAggregationHandler}
              checked={groupBy !== null}
            />
          </div>
        )}

        {displayGroupBy && (
          <FormLabel label={t('chartV2.form.axisConfig.groupBy')}>
            <ColumnSelect
              value={groupBy!}
              onChange={(value) => {
                updateStorageByPath(`query.groupBy`, value);
              }}
              notAllowedFields={[FieldType.Attachment]}
            />
          </FormLabel>
        )}
      </FormLabel>
    </div>
  );
};
