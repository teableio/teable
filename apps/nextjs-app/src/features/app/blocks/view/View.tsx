import type { IRecord } from '@teable-group/core';
import { useIsHydrated } from '@teable-group/sdk';
import { Skeleton } from '@teable-group/ui-lib/shadcn';
import dynamic from 'next/dynamic';
import { useRef } from 'react';
import type { IExpandRecordContainerRef } from '../../components/ExpandRecordContainer';
import { ExpandRecordContainer } from '../../components/ExpandRecordContainer';
import { useGraphStore } from '../graph/useGraphStore';
import { GridView } from './grid/GridView';

const Graph = dynamic(() => import('../graph/Graph').then<React.FC>((mod) => mod.Graph), {
  loading: () => (
    <div className="absolute top-20 right-10 bg-background rounded shadow border w-96 space-y-2 p-4">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
    </div>
  ),
  ssr: false,
});

interface IView {
  recordServerData?: IRecord;
}

export const View = (props: IView) => {
  const { recordServerData } = props;
  const isHydrated = useIsHydrated();
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);
  const { graphOpen } = useGraphStore();
  if (!isHydrated) {
    return <div className="w-full grow overflow-hidden pl-2" />;
  }

  return (
    <div className="w-full grow overflow-hidden pl-2">
      <GridView expandRecordRef={expandRecordRef} />
      <ExpandRecordContainer ref={expandRecordRef} recordServerData={recordServerData} />
      {graphOpen && <Graph />}
    </div>
  );
};
