import { LocalStorageKeys } from '@teable-group/sdk';
import { noop } from 'lodash';
import { create } from 'zustand';
// import { persist } from 'zustand/middleware';

// interface ISideBarStore {
//   visible?: boolean;
//   sizes?: number[];
//   toggleSideBar?: (visible?: boolean) => void;
//   setSize?: (sizes: number[]) => void;
// }

interface ISideBarStore {
  expandSideBar: () => void;
  collapseSideBar: () => void;
  setExpandFn: (fn: () => void) => void;
  setCollapseFn: (fn: () => void) => void;
}

export const useSiderBarStore = create<ISideBarStore>((set) => ({
  expandSideBar: noop,
  collapseSideBar: noop,
  setExpandFn: (fn) => {
    set((state) => ({ ...state, collapseSideBar: fn }));
  },
  setCollapseFn: (fn) => {
    set((state) => ({ ...state, collapseSideBar: fn }));
  },
}));

// export const useSiderBarStore = create<ISideBarStore>()(
//   persist(
//     (set, get) => ({
//       visible: get()?.visible,
//       sizes: get()?.sizes,
//       toggleSideBar: (visible?: boolean) => {
//         set({
//           visible: visible ?? !get()?.visible,
//           sizes: get()?.sizes,
//         });
//       },
//       setSize: (sizes: number[]) => {
//         set({
//           visible: get()?.visible,
//           sizes: sizes,
//         });
//       },
//     }),
//     {
//       name: `react-resizable-panels1:${LocalStorageKeys.SideBarSize}`,
//     }
//   )
// );
