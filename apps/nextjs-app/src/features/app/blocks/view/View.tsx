import { ViewType, type IRecord } from '@teable-group/core';
import { useIsHydrated, useView, useViewId } from '@teable-group/sdk';
import { Skeleton, cn } from '@teable-group/ui-lib/shadcn';
import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import { useMedia } from 'react-use';
import type { IExpandRecordContainerRef } from '../../components/ExpandRecordContainer';
import { ExpandRecordContainer } from '../../components/ExpandRecordContainer';
import { useGraphStore } from '../graph/useGraphStore';
import { FormView } from './form/FormView';
import { GridView } from './grid/GridView';

const Graph = dynamic(() => import('../graph/Graph').then<React.FC>((mod) => mod.Graph), {
  loading: () => (
    <div className="absolute right-10 top-20 w-96 space-y-2 rounded border bg-background p-4 shadow">
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
  const activeViewId = useViewId();
  const view = useView(activeViewId);
  const viewType = view?.type;
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);
  const { graphOpen } = useGraphStore();

  // Determine whether it is a touch device
  const isTouchDevice = useMedia('(pointer: coarse)');

  // Solve the problem that the page will be pushed up after the input is focused on touch devices
  useEffect(() => {
    if (!isTouchDevice) return;

    const onFocusout = () => {
      setTimeout(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }));
    };
    document.body.addEventListener('focusout', onFocusout);
    return () => document.body.removeEventListener('focusout', onFocusout);
  }, [isTouchDevice]);

  if (!isHydrated) {
    return <div className="w-full grow overflow-hidden pl-2" />;
  }

  const getViewComponent = () => {
    switch (viewType) {
      case ViewType.Grid:
        return <GridView expandRecordRef={expandRecordRef} />;
      case ViewType.Form:
        return <FormView />;
      default:
        return null;
    }
  };

  return (
    <div className={cn('w-full grow overflow-hidden', viewType === ViewType.Grid && 'sm:pl-2')}>
      {getViewComponent()}
      {viewType !== ViewType.Form && (
        <ExpandRecordContainer ref={expandRecordRef} recordServerData={recordServerData} />
      )}
      {graphOpen && <Graph />}
    </div>
  );
};
