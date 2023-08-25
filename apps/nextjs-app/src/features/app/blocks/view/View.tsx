import type { IRecord } from '@teable-group/core';
import { useIsHydrated } from '@teable-group/sdk';
import { useRef } from 'react';
import type { IExpandRecordContainerRef } from '../../components/ExpandRecordContainer';
import { ExpandRecordContainer } from '../../components/ExpandRecordContainer';
import { GridView } from './grid/GridView';

interface IView {
  recordServerData?: IRecord;
}

export const View = (props: IView) => {
  const { recordServerData } = props;
  const isHydrated = useIsHydrated();
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);

  return (
    <div className="w-full grow overflow-hidden pl-2">
      {isHydrated && <GridView expandRecordRef={expandRecordRef} />}
      {isHydrated && (
        <ExpandRecordContainer ref={expandRecordRef} recordServerData={recordServerData} />
      )}
    </div>
  );
};
