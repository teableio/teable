import { Card, CardHeader, CardTitle, CardContent } from '@teable/ui-lib/shadcn';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useChartData } from '../hooks/useChartData';

export function BarChartCard({ className }: { className?: string }) {
  const data = useChartData();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{data.title} (Bar)</CardTitle>
      </CardHeader>
      <CardContent className="pl-2">
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={data.list}>
            <XAxis
              dataKey="name"
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${value}`}
            />
            <Bar dataKey="total" fill="#adfa1d" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
