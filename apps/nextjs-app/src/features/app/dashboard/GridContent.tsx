import { StatisticsFunc } from '@teable/core';
import { ExpandRecorder } from '@teable/sdk/components';
import { useTableId, useViewId } from '@teable/sdk/hooks';
import { TabsContent, Card, CardContent, CardHeader, CardTitle } from '@teable/ui-lib/shadcn';
import { useState } from 'react';
import { GridViewBase } from '../blocks/view/grid/GridViewBase';
import { BarChartCard } from './components/BarChart';
import { LineChartCard } from './components/LineChart';
import { PieChartCard } from './components/PieChart';
import { useAggregates } from './hooks/useAggregates';

const test = [
  StatisticsFunc.Average,
  StatisticsFunc.Sum,
  StatisticsFunc.Sum,
  StatisticsFunc.Average,
];

export const GridContent: React.FC = () => {
  const aggs = useAggregates(test);
  const viewId = useViewId();
  const tableId = useTableId();
  const [expandRecordId, setExpandRecordId] = useState<string>();

  return (
    <TabsContent value="overview" className="grow space-y-4 px-8 ">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {aggs.map((agg, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {agg?.name}({agg?.func})
              </CardTitle>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                className="size-4 text-muted-foreground"
              >
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{agg?.value || '0'}</div>
              <p className="text-xs text-muted-foreground">{agg?.func}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-8">
        <BarChartCard className="col-span-4" />
        <PieChartCard className="col-span-4" />
      </div>
      <div className="grid grid-cols-1">
        <LineChartCard />
      </div>
      <div className="grid grid-cols-1">
        <div className="h-[600px] w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow">
          {viewId && <GridViewBase onRowExpand={setExpandRecordId} />}
          {tableId && viewId && (
            <ExpandRecorder
              tableId={tableId}
              recordId={expandRecordId}
              recordIds={expandRecordId ? [expandRecordId] : []}
              onClose={() => setExpandRecordId(undefined)}
            />
          )}
        </div>
      </div>
    </TabsContent>
  );
};
