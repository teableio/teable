import type { IRecord } from '@teable/core';
import type { IGroupPointsVo } from '@teable/openapi';

export interface IViewBaseProps {
  recordsServerData: { records: IRecord[] };
  recordServerData?: IRecord;
  groupPointsServerDataMap?: { [viewId: string]: IGroupPointsVo | undefined };
}
