import create from 'zustand';

interface ISelectFileNode {
  name: string;
  path: string;
}

interface IAppState {
  currentPath?: string;
  currentFile?: ISelectFileNode;
  setCurrentFile: (currentFile: ISelectFileNode) => void;
}
export const useAppStore = create<IAppState>((set) => ({
  currentFile: undefined,
  setCurrentFile: (file: ISelectFileNode) => set(() => ({ currentFile: file })),
}));
