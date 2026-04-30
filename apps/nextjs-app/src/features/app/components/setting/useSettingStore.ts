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

export type SettingDialogTab = string;

interface ISettingState {
  tab?: SettingDialogTab;
  setTab: (tab: SettingDialogTab) => void;
  open: boolean;
  setOpen: (open: boolean, tab?: SettingDialogTab) => void;
}

export const useSettingStore = create<ISettingState>((set) => ({
  open: false,
  setOpen: (open: boolean, tab?: SettingDialogTab) => {
    set((state) => {
      return {
        ...state,
        open,
        tab,
      };
    });
  },
  setTab: (tab: SettingDialogTab) => {
    set((state) => {
      return {
        ...state,
        tab,
      };
    });
  },
}));
