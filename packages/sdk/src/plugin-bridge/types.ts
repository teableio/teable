import type { IGetBasePermissionVo } from '@teable/openapi';
import type { AsyncMethodReturns } from 'penpal';

export interface IUIConfig {
  isShowingSettings: boolean;
  theme?: string;
}

export type IBasePermissions = IGetBasePermissionVo;

export interface IParentBridgeMethods {
  expandRecord: (recordIds: string[]) => void;
  updateStorage: (storage?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface IChildBridgeMethods {
  syncUIConfig: (uiConfig: IUIConfig) => void;
  syncBasePermissions: (permissions: IBasePermissions) => void;
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
