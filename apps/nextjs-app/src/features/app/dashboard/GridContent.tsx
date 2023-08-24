import { StatisticsFunc } from '@teable-group/core';
import { useIsHydrated } from '@teable-group/sdk';
import { useViewId } from '@teable-group/sdk/hooks';
import {
  TabsContent,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@teable-group/ui-lib/shadcn';
import { useRef } from 'react';
import { GridView } from '../blocks/view/grid/GridView';
import type { IExpandRecordContainerRef } from '../components/ExpandRecordContainer';
import { ExpandRecordContainer } from '../components/ExpandRecordContainer';
import { Overview } from './components/Overview';
import { RecentSales } from './components/RecentSales';
import { useAggregates } from './hooks/useAggregates';

const test = [
  StatisticsFunc.Sum,
  StatisticsFunc.Average,
  StatisticsFunc.Filled,
  StatisticsFunc.Unique,
];

export const GridContent: React.FC = () => {
  const aggs = useAggregates(test);
  const isHydrated = useIsHydrated();
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);
  const viewId = useViewId();

  return (
    <TabsContent value="overview" className="grow space-y-4 px-8 ">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {aggs.map((agg) => (
          <Card key={agg?.func}>
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
                className="text-muted-foreground h-4 w-4"
              >
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{agg?.value || '0'}</div>
              <p className="text-muted-foreground text-xs">{agg?.func}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <Overview />
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Recent Sales</CardTitle>
            <CardDescription>You made 265 sales this month.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecentSales />
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1">
        {isHydrated && <ExpandRecordContainer ref={expandRecordRef} />}
        <div className="h-[600px] w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow">
          {viewId && <GridView expandRecordRef={expandRecordRef} />}
        </div>
      </div>
    </TabsContent>
  );
};
