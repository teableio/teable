/* eslint-disable sonarjs/cognitive-complexity */
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  cn,
} from '@teable/ui-lib';
import React, { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Label,
  LabelList,
  Line,
  Rectangle,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import type { Payload } from 'recharts/types/component/DefaultLegendContent';
import { useBaseQueryData } from '../../../../hooks/useBaseQueryData';
import { useUIConfig } from '../../../../hooks/useUIConfig';
import type {
  IAreaConfig,
  IBarConfig,
  IChartBaseAxisDisplayLine,
  IComboConfig,
  IComboType,
} from '../../../../types';
import { TooltipItem } from './TooltipItem';
import { useComboConfig } from './useComboConfig';

export const ChartCombo = (props: { config: IComboConfig; defaultType?: IComboType }) => {
  const { config, defaultType = 'bar' } = props;

  const queryData = useBaseQueryData();
  const chartConfig = useComboConfig(config, queryData?.columns);
  const { isExpand } = useUIConfig();
  const [hoverLegend, setHoverLegend] = useState<string>();
  const [hiddenLegends, setHiddenLegends] = useState<string[]>([]);
  const [hoverBarIndex, setHoverBarIndex] = useState<number>();

  const handleLegendMouseEnter = (o: Payload) => {
    const { dataKey } = o;
    setHoverLegend(dataKey as string);
  };

  const handleLegendMouseLeave = () => {
    setHoverLegend(undefined);
  };

  const handleLegendClick = (o: Payload) => {
    const { dataKey } = o;
    if (hiddenLegends.includes(dataKey as string)) {
      setHiddenLegends(hiddenLegends.filter((legend) => legend !== dataKey));
    } else {
      setHiddenLegends([...hiddenLegends, dataKey as string]);
    }
  };

  const yAxisMap = useMemo(() => {
    if (!config.yAxis) {
      return {};
    }
    return config.yAxis?.reduce(
      (acc, yAxis) => {
        return {
          ...acc,
          [yAxis.column]: yAxis,
        };
      },
      {} as Record<string, NonNullable<IComboConfig['yAxis']>[number]>
    );
  }, [config.yAxis]);

  const chartYAxis = useMemo(() => {
    const chartYAxis: (NonNullable<IComboConfig['yAxis']>[number] & {
      position: 'left' | 'right';
    })[] = [];
    config.yAxis?.forEach((yAxisItem) => {
      const position = yAxisItem.display.position === 'auto' ? 'left' : yAxisItem.display.position;
      if (chartYAxis.find((axis) => axis.position === position)) {
        return;
      }
      chartYAxis.push({
        ...yAxisItem,
        position,
      });
    });
    return chartYAxis;
  }, [config.yAxis]);

  const defaultYAxisId = chartYAxis.find((axis) => axis.position === 'left')?.column;
  const showGoalLine = defaultYAxisId && config.goalLine?.enabled;
  const xAxisConfig = config.xAxis?.[0];

  const defaultMargin = isExpand
    ? {
        top: 20,
        left: 12,
        right: 12,
        bottom: 25,
      }
    : {
        top: 20,
        left: 10,
        right: 4,
        bottom: 25,
      };
  return (
    <div
      className={cn('size-full', {
        'p-4': isExpand,
      })}
    >
      <ChartContainer className="size-full" config={chartConfig}>
        <ComposedChart
          margin={{
            top: config.padding?.top ?? defaultMargin.top,
            left: config.padding?.left ?? defaultMargin.left,
            right: config.padding?.right ?? defaultMargin.right,
            bottom: config.padding?.bottom ?? defaultMargin.bottom,
          }}
          accessibilityLayer
          data={queryData?.rows}
        >
          <CartesianGrid vertical={false} />
          {xAxisConfig && (
            <XAxis
              dataKey={xAxisConfig.column}
              tickLine={false}
              tickMargin={isExpand ? 10 : undefined}
              axisLine={false}
            >
              {<Label value={config.xAxisDisplay?.label} position="bottom" fontSize={12} />}
            </XAxis>
          )}
          {chartYAxis.map(({ column, position, prefix, suffix, decimal }, index) => (
            <YAxis
              key={column}
              yAxisId={column}
              label={{
                value: config.yAxisDisplay?.label,
                offset: config?.padding?.left ? defaultMargin.left - config.padding.left + 5 : 5,
                angle: -90,
                position: 'insideLeft',
              }}
              domain={
                index === 0
                  ? [
                      config.yAxisDisplay?.range?.min ?? 0,
                      config.yAxisDisplay?.range?.max ?? 'auto',
                    ]
                  : undefined
              }
              orientation={position}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              tickFormatter={(value) => {
                return `${prefix ?? ''}${decimal ? value.toFixed(decimal) : value}${suffix ?? ''}`;
              }}
            />
          ))}
          <ChartLegend
            verticalAlign="top"
            onMouseEnter={handleLegendMouseEnter}
            onMouseLeave={handleLegendMouseLeave}
            onClick={handleLegendClick}
            content={<ChartLegendContent className="cursor-pointer" />}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="dashed"
                formatter={(value, name, item) => {
                  const { prefix, decimal, suffix } = yAxisMap[name];
                  return (
                    <TooltipItem
                      label={chartConfig[name].label as string}
                      indicatorColor={item.color}
                    >
                      {`${prefix ?? ''}${decimal && typeof value === 'number' ? value.toFixed(decimal) : value}${suffix ?? ''}`}
                    </TooltipItem>
                  );
                }}
              />
            }
          />
          {Object.keys(chartConfig).map((column) => {
            const display = yAxisMap[column]?.display;
            const { prefix, decimal, suffix } = yAxisMap[column];
            const type = display.type || defaultType;
            const lineStyle = (display as IChartBaseAxisDisplayLine).lineStyle;
            const yAxisId = chartYAxis.find((axis) => axis.column === column)
              ? column
              : defaultYAxisId;
            switch (type) {
              case 'bar':
                return (
                  <Bar
                    isAnimationActive
                    activeIndex={hoverBarIndex}
                    key={column}
                    yAxisId={yAxisId}
                    dataKey={column}
                    strokeWidth={2}
                    fill={`var(--color-${column})`}
                    stackId={(config as IBarConfig).stack ? 'stack' : undefined}
                    radius={(config as IBarConfig).stack ? 0 : 4}
                    className="transition-[fill-opacity]"
                    fillOpacity={hoverLegend && hoverLegend !== column ? 0.5 : 1}
                    hide={hiddenLegends.includes(column)}
                    onMouseEnter={(o) => setHoverBarIndex(o.index)}
                    activeBar={({ ...params }) => {
                      return (
                        <Rectangle
                          {...params}
                          stroke={params.fill}
                          strokeDasharray={4}
                          strokeDashoffset={4}
                        />
                      );
                    }}
                  >
                    {config.showLabel && (
                      <LabelList
                        position="top"
                        offset={12}
                        className="fill-foreground"
                        fontSize={12}
                        formatter={(value: number) => {
                          return `${prefix ?? ''}${decimal ? value.toFixed(decimal) : value}${suffix ?? ''}`;
                        }}
                      />
                    )}
                  </Bar>
                );
              case 'line':
                return (
                  <Line
                    key={column}
                    yAxisId={yAxisId}
                    dataKey={column}
                    type={lineStyle === 'normal' ? 'natural' : lineStyle}
                    stroke={`var(--color-${column})`}
                    strokeWidth={2}
                    dot={{ fill: `var(--color-${column})` }}
                    activeDot={{ r: 6 }}
                    fillOpacity={hoverLegend && hoverLegend !== column ? 0.5 : 1}
                    hide={hiddenLegends.includes(column)}
                  >
                    {config.showLabel && (
                      <LabelList
                        position="top"
                        offset={12}
                        className="fill-foreground"
                        fontSize={12}
                        formatter={(value: number) => {
                          return `${prefix ?? ''}${decimal ? value.toFixed(decimal) : value}${suffix ?? ''}`;
                        }}
                      />
                    )}
                  </Line>
                );
              case 'area':
                return (
                  <Area
                    key={column}
                    yAxisId={yAxisId}
                    dataKey={column}
                    type={lineStyle === 'normal' ? 'natural' : lineStyle}
                    stackId={(config as IAreaConfig).stack ? 'stack' : undefined}
                    stroke={`var(--color-${column})`}
                    fill={`var(--color-${column})`}
                    className="transition-[fill-opacity]"
                    fillOpacity={hoverLegend === column ? 1 : 0.4}
                    hide={hiddenLegends.includes(column)}
                  >
                    {config.showLabel && (
                      <LabelList
                        position="top"
                        offset={12}
                        className="fill-foreground"
                        fontSize={12}
                        formatter={(value: number) => {
                          return `${prefix ?? ''}${decimal ? value.toFixed(decimal) : value}${suffix ?? ''}`;
                        }}
                      />
                    )}
                  </Area>
                );
            }
          })}
          {showGoalLine && (
            <ReferenceLine
              yAxisId={defaultYAxisId}
              y={config.goalLine?.value ?? 0}
              stroke="hsl(var(--foreground))"
              strokeDasharray="2 6"
            >
              <Label
                value={config.goalLine?.label}
                position="top"
                fontSize={12}
                fill="hsl(var(--foreground))"
              />
            </ReferenceLine>
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
};
