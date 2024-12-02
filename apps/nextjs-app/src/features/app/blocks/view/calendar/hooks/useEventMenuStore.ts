import { create } from 'zustand';
import type { ICalendarPermission } from '../type';

interface IEventMenu {
  eventId: string;
  permission: ICalendarPermission;
  position: {
    x: number;
    y: number;
  };
}

interface IEventMenuState {
  eventMenu?: IEventMenu;
  openEventMenu: (props: IEventMenu) => void;
  closeEventMenu: () => void;
}

export const useEventMenuStore = create<IEventMenuState>((set) => ({
  openEventMenu: (props) => {
    set((state) => {
      return {
        ...state,
        eventMenu: props,
      };
    });
  },
  closeEventMenu: () => {
    set((state) => {
      if (state.eventMenu == null) {
        return state;
      }
      return {
        ...state,
        eventMenu: undefined,
      };
    });
  },
}));
