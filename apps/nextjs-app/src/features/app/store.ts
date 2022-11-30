import create from 'zustand';

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
export const useAppStore = create<IAppState>((set) => ({
  currentFile: undefined,
  selectPath: undefined,
  setCurrentFile: (file: ISelectFileNode) => set(() => ({ currentFile: file })),
  setSelectPath: (path: string) => set(() => ({ selectPath: path })),
}));
