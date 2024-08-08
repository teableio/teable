import {
  Card,
  CardContent,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@teable/ui-lib';
import type { ChartConfig } from '@teable/ui-lib';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { Payload } from 'recharts/types/component/DefaultLegendContent';

export const ChartBar = (props: {
  chartData: Record<string, unknown>[];
  chartConfig: ChartConfig;
  xAxis: string;
}) => {
  const { chartData, chartConfig, xAxis } = props;

  const [hoverLegend, setHoverLegend] = useState<string>();
  const [hiddenLegends, setHiddenLegends] = useState<string[]>([]);

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

  return (
    <Card>
      <CardContent className="p-4">
        <ChartContainer config={chartConfig}>
          <BarChart accessibilityLayer data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey={xAxis} tickLine={false} tickMargin={10} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} tickMargin={10} />
            <ChartLegend
              onMouseEnter={handleLegendMouseEnter}
              onMouseLeave={handleLegendMouseLeave}
              onClick={handleLegendClick}
              content={<ChartLegendContent className="cursor-pointer" />}
            />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dashed" />} />
            {Object.keys(chartConfig).map((key) => (
              <Bar
                key={key}
                dataKey={key}
                fill={`var(--color-${key})`}
                radius={4}
                className="transition-[fill-opacity]"
                fillOpacity={hoverLegend && hoverLegend !== key ? 0.5 : 1}
                hide={hiddenLegends.includes(key)}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
};
