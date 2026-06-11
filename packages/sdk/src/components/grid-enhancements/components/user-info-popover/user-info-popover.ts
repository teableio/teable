import { create } from 'zustand';
import type { IRectangle } from '../../../grid/interface';
import type { IUserData } from '../../../grid/renderers/cell-renderer/interface';

interface IUserInfoPopoverInfo {
  id?: string;
  user: IUserData;
  position: IRectangle;
}

interface IUserInfoPopoverState {
  popoverInfo?: IUserInfoPopoverInfo;
  openPopover: (info: IUserInfoPopoverInfo) => void;
  closePopover: () => void;
}

export const useUserInfoPopoverStore = create<IUserInfoPopoverState>((set) => ({
  openPopover: (info) => {
    set((state) => ({ ...state, popoverInfo: info }));
  },
  closePopover: () => {
    set((state) => {
      if (state.popoverInfo == null) return state;
      return { ...state, popoverInfo: undefined };
    });
  },
}));
