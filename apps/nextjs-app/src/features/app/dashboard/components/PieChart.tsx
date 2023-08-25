import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@teable-group/ui-lib/shadcn';
import { Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useChartData } from '../hooks/useChartData';

export function PieChartCard({ className }: { className?: string }) {
  const data = useChartData();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Proportion</CardTitle>
        <CardDescription>Your data distribution ratio.</CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <ResponsiveContainer width="100%" height={350}>
          <PieChart
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
                console.log(active, payload);
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border bg-background p-2 shadow-sm">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col">
                          <span className="text-[0.70rem] uppercase text-muted-foreground">
                            Count
                          </span>
                          <span className="font-bold text-muted-foreground">
                            {payload[0].value}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }

                return null;
              }}
            />

            <Pie
              data={data}
              dataKey="total"
              nameKey="name"
              stroke="hsl(var(--background))"
              fill="hsl(var(--foreground))"
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
