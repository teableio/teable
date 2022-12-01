import create from 'zustand';
import { persist } from 'zustand/middleware';

interface ISelectFileNode {
  name: string;
  path: string;
}

interface IAppState {
  selectPath?: string;
  currentPath?: string;
  currentFile?: ISelectFileNode;
  setCurrentFile: (currentFile: ISelectFileNode) => void;
  setSelectPath: (selectPath: string) => void;
}
export const useAppStore = create(
  persist<IAppState>(
    (set) => ({
      currentFile: undefined,
      selectPath: undefined,
      setCurrentFile: (file: ISelectFileNode) =>
        set(() => ({ currentFile: file })),
      setSelectPath: (path: string) => set(() => ({ selectPath: path })),
    }),
    {
      name: 'teable-app',
    }
  )
);
