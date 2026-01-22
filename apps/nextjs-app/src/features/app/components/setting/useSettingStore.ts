import { create } from 'zustand';

export enum SettingTab {
  Profile = 'profile',
  System = 'system',
  Notifications = 'notifications',
  Integration = 'integration',
  PersonalAccessToken = 'personal-access-token',
  OAuthApp = 'oauth-app',
  License = 'license',
  LicensePlan = 'license-plan',
}

interface ISettingState {
  tab?: SettingTab;
  setTab: (tab: SettingTab) => void;
  open: boolean;
  setOpen: (open: boolean, tab?: SettingTab) => void;
}

export const useSettingStore = create<ISettingState>((set) => ({
  open: false,
  setOpen: (open: boolean, tab?: SettingTab) => {
    set((state) => {
      return {
        ...state,
        open,
        tab,
      };
    });
  },
  setTab: (tab: SettingTab) => {
    set((state) => {
      return {
        ...state,
        tab,
      };
    });
  },
}));
