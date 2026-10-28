import { create } from 'zustand';

export enum PersonalSettingTab {
  Profile = 'profile',
  System = 'system',
  Integration = 'integration',
  DeveloperTools = 'developer-tools',
  // Developer tools' sub-tabs: opening one selects Developer tools with that sub-tab shown.
  PersonalAccessToken = 'personal-access-token',
  OAuthApp = 'oauth-app',
  TeableSkill = 'teable-skill',
  Mcp = 'mcp',
  EnvVariable = 'env-variable',
  License = 'license',
  Artifacts = 'artifacts',
  ArchivedChats = 'archived-chats',
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
