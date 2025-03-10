import type { IFieldVo } from '@teable/core';
import type { IGetBasePermissionVo, IGetTempTokenVo, IRecordsVo } from '@teable/openapi';
import type { AsyncMethodReturns } from 'penpal';
import type { IRange, SelectionRegionType } from '../components/grid/interface';

export interface IUIConfig {
  isExpand?: boolean;
  isShowingSettings?: boolean;
  theme?: string;
}

export type IUrlParams = Partial<
  Record<'baseId' | 'tableId' | 'viewId' | 'dashboardId' | 'recordId' | 'shareId', string>
>;

export interface ISelection {
  range: IRange[];
  type: SelectionRegionType;
}

export interface IGetSelectionRecordsVo {
  records: IRecordsVo['records'];
  fields: IFieldVo[];
}

export type IBasePermissions = IGetBasePermissionVo;

export interface IParentBridgeUIMethods {
  expandRecord: (recordIds: string[]) => void;
  expandPlugin: () => void;
}

export interface IParentBridgeUtilsMethods {
  updateStorage: (storage?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getAuthCode: () => Promise<string>;
  getSelfTempToken: () => Promise<IGetTempTokenVo>;
  getSelectionRecords: (
    selection: ISelection,
    options?: {
      // The number of records to skip, default is 0
      skip?: number;
      // The number of records to take, default is 100
      take?: number;
    }
  ) => Promise<IGetSelectionRecordsVo>;
}

export type IParentBridgeMethods = IParentBridgeUIMethods & IParentBridgeUtilsMethods;

export interface IChildBridgeMethods {
  syncUIConfig: (uiConfig: IUIConfig) => void;
  syncSelection: (selection?: ISelection) => void;
  syncBasePermissions: (permissions: IBasePermissions) => void;
  syncUrlParams: (urlParams: IUrlParams) => void;
}

export type IBridgeListener = {
  on: <T extends keyof IChildBridgeMethods>(event: T, listener: IChildBridgeMethods[T]) => void;
  removeListener: <T extends keyof IChildBridgeMethods>(
    event: T,
    listener: IChildBridgeMethods[T]
  ) => void;
  removeAllListeners: <T extends keyof IChildBridgeMethods>(event?: T) => void;
  destroy: () => void;
};

export type IPluginBridge = AsyncMethodReturns<IParentBridgeMethods> & IBridgeListener;
