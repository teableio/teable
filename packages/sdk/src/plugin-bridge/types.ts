import type { AsyncMethodReturns } from 'penpal';

export interface IUIConfig {
  isShowingSettings: boolean;
  isExpand: boolean;
}

export interface IParentBridgeMethods {
  expandRecord: (recordIds: string[]) => void;
}

export interface IChildBridgeMethods {
  syncUIConfig: (uiConfig: IUIConfig) => void;
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
