import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@teable-group/ui-lib/shadcn';
import { Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useLineChartData } from '../hooks/useLineChartData';

export function LineChartCard() {
  const data = useLineChartData();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparison</CardTitle>
        <CardDescription>Compare average and minimum values.</CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{
                top: 5,
                right: 10,
                left: 10,
                bottom: 0,
              }}
            >
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="rounded-lg border bg-background p-2 shadow-sm">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col">
                            <span className="text-[0.70rem] uppercase text-muted-foreground">
                              Average
                            </span>
                            <span className="font-bold text-muted-foreground">
                              {payload[0].value}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[0.70rem] uppercase text-muted-foreground">
                              Today
                            </span>
                            <span className="font-bold">{payload[1].value}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return null;
                }}
              />
              <Line
                type="monotone"
                strokeWidth={2}
                dataKey="average"
                activeDot={{
                  r: 6,
                  style: { fill: 'var(--theme-primary)', opacity: 0.25 },
                }}
                style={
                  {
                    stroke: 'hsl(var(--primary))',
                    opacity: 0.25,
                  } as React.CSSProperties
                }
              />
              <Line
                type="monotone"
                dataKey="total"
                strokeWidth={2}
                activeDot={{
                  r: 8,
                  style: { fill: 'var(--theme-primary)' },
                }}
                style={
                  {
                    stroke: 'hsl(var(--primary))',
                  } as React.CSSProperties
                }
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
