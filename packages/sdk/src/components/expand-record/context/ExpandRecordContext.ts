import type { IRecord } from '@teable-group/core';
import React from 'react';

export enum IExpandRecordModel {
  Modal = 'modal',
  Panel = 'panel',
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ExpandRecordContext = React.createContext<{
  serverRecord?: IRecord;
  model?: IExpandRecordModel;
  hideActivity?: boolean;
  updateModel?: (val?: IExpandRecordModel) => void;
  updateHideActivity?: (val?: boolean) => void;
}>({});
