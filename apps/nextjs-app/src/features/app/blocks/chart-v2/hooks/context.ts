import type { IParentBridgeMethods, IUIConfig } from '@teable/sdk/plugin-bridge';
import React from 'react';
import type { IPageParams } from '../../chart/types';

interface IPluginInstallContext {
  parentBridgeMethods: IParentBridgeMethods;
  pageParams: IPageParams;
  uiConfig: IUIConfig;
}

export const PluginInstallContext = React.createContext<IPluginInstallContext | null>(null);
