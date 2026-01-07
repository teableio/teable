import { createContext, useContext } from 'react';
import type { IUnpublishedApp } from './UnpublishedAppsDialog';

export interface IAppPublishContextValue {
  publishApp?: (app: IUnpublishedApp) => Promise<void>;
  onAppStateChange?: (callback: (apps: IUnpublishedApp[]) => void) => void;
  onPublishComplete?: (callback: () => void) => void;
}

export const AppPublishContext = createContext<IAppPublishContextValue>({});

export const useAppPublishContext = () => {
  return useContext(AppPublishContext);
};
