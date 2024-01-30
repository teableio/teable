import type { IRecord } from '@teable/core';

export interface IViewBaseProps {
  recordsServerData: { records: IRecord[] };
  recordServerData?: IRecord;
}
