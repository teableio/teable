import type { IRecord } from '@teable-group/core';

export interface IViewBaseProps {
  recordsServerData: { records: IRecord[] };
  recordServerData?: IRecord;
}
