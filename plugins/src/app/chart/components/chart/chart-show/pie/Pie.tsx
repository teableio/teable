import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@teable/ui-lib';
import { useMemo, useState } from 'react';
import { PieChart, Pie, Label, Sector } from 'recharts';
import type { Payload } from 'recharts/types/component/DefaultLegendContent';
import type { PieSectorDataItem } from 'recharts/types/polar/Pie';
import { useBaseQueryData } from '../../../../hooks/useBaseQueryData';
import { useUIConfig } from '../../../../hooks/useUIConfig';
import type { IPieConfig } from '../../../types';
import { TooltipItem } from '../combo/TooltipItem';
import { usePieConfig } from './usePieConfig';
import { useRefObserve } from './useRefObserve';

export const ChartPie = (props: { config: IPieConfig }) => {
  const { config } = props;
  const queryData = useBaseQueryData();
  const pieConfig = usePieConfig(config.dimension, queryData?.rows);
  const [hoverLegend, setHoverLegend] = useState<number>();
  const [hoverPieIndex, setHoverPieIndex] = useState<number>();
  const { isExpand } = useUIConfig();
  const total = useMemo(() => {
    const measure = config.measure;
    if (!queryData?.rows || !measure) {
      return 0;
    }
    return queryData.rows.reduce((acc, cur) => acc + (cur[measure.column] as number), 0);
  }, [queryData?.rows, config.measure]);

  const chartData = useMemo(() => {
    const dimension = config.dimension;
    if (!queryData?.rows || !dimension) {
      return [];
    }
    return queryData.rows.map((row, index) => ({
      ...row,
      fill: `var(--color-pie-${index})`,
    }));
  }, [config.dimension, queryData?.rows]);

  const handleLegendMouseEnter = (_o: Payload, index: number) => {
    setHoverLegend(index);
  };

  const handleLegendMouseLeave = () => {
    setHoverLegend(undefined);
  };

  const [totalRef, { width: totalWidth }] = useRefObserve();
  const defaultMargin = isExpand
    ? {
        top: 20,
        right: 20,
        bottom: 20,
        left: 20,
      }
    : {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      };
  return (
    <div className="chart-pie flex size-full items-center justify-center">
      {/* calculate total width */}
      <svg className="pointer-events-none absolute -z-10" style={{ visibility: 'hidden' }}>
        <text
          fontSize="20"
          style={{
            visibility: 'hidden',
          }}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          <tspan ref={totalRef} className="fill-foreground text-3xl font-bold">
            {total}
          </tspan>
          <tspan className="fill-muted-foreground">Total</tspan>
        </text>
      </svg>
      <ChartContainer config={pieConfig} className="size-full">
        <PieChart
          margin={{
            top: config.padding?.top ?? defaultMargin.top,
            left: config.padding?.left ?? defaultMargin.left,
            right: config.padding?.right ?? defaultMargin.right,
            bottom: config.padding?.bottom ?? defaultMargin.bottom,
          }}
        >
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="dashed"
                formatter={(value, name, item) => {
                  const { prefix, decimal, suffix } = config.measure ?? {};
                  return (
                    <TooltipItem
                      label={name as string}
                      indicatorColor={item.color ?? item.payload.fill}
                    >
                      {`${prefix ?? ''}${decimal && typeof value === 'number' ? value.toFixed(decimal) : value}${suffix ?? ''}`}
                      {`(${total ? (((value as number) / total) * 100).toFixed(2) : 0}%)`}
                    </TooltipItem>
                  );
                }}
              />
            }
          />
          {config.showLegend && (
            <ChartLegend
              verticalAlign="top"
              onMouseEnter={handleLegendMouseEnter}
              onMouseLeave={handleLegendMouseLeave}
              content={<ChartLegendContent className="cursor-pointer" />}
            />
          )}
          <Pie
            data={chartData}
            dataKey={config.measure?.column ?? ''}
            nameKey={config.dimension}
            innerRadius={'50%'}
            label={
              config.showLabel
                ? ({ value, ...props }) => {
                    const { prefix, decimal, suffix } = config.measure ?? {};
                    return (
                      <text
                        cx={props.cx}
                        cy={props.cy}
                        x={props.x}
                        y={props.y}
                        textAnchor={props.textAnchor}
                        dominantBaseline={props.dominantBaseline}
                        fill={props.fill}
                      >
                        {`${prefix ?? ''}${decimal && typeof value === 'number' ? value.toFixed(decimal) : value}${suffix ?? ''}`}
                        {`(${total ? ((value / total) * 100).toFixed(2) : 0}%)`}
                      </text>
                    );
                  }
                : false
            }
            activeIndex={hoverPieIndex ?? hoverLegend}
            onMouseEnter={(o) => setHoverPieIndex(o.index)}
            activeShape={({ outerRadius = 0, ...props }: PieSectorDataItem) => (
              <Sector {...props} outerRadius={outerRadius + 10} />
            )}
          >
            {config.showTotal && (
              <Label
                content={({ viewBox }) => {
                  if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                    const { prefix, decimal, suffix } = config.measure ?? {};
                    const totalDisplay = `${prefix ?? ''}${decimal ? total.toFixed(decimal) : total}${suffix ?? ''}`;
                    return (
                      <text
                        style={{
                          visibility:
                            totalWidth > viewBox.innerRadius! * 2 || 70 > viewBox.innerRadius! * 2
                              ? 'hidden'
                              : 'visible',
                        }}
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {totalDisplay}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground"
                        >
                          Total
                        </tspan>
                      </text>
                    );
                  }
                }}
              />
            )}
          </Pie>
        </PieChart>
      </ChartContainer>
    </div>
  );
};
