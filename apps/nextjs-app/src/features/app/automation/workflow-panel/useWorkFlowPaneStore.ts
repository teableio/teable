import { create } from 'zustand';

interface IWorkFlowPanelState {
  baseId?: string;
  workflowId?: string;
  buttonFieldId?: string;
  closeModal: () => void;
  openModal: (baseId: string, workflowId: string) => void;
  setModal: (props: Pick<IWorkFlowPanelState, 'baseId' | 'workflowId' | 'buttonFieldId'>) => void;
}

export const useWorkFlowPanelStore = create<IWorkFlowPanelState>((set) => ({
  closeModal: () => {
    set((state) => {
      return {
        ...state,
        baseId: undefined,
        workflowId: undefined,
        buttonFieldId: undefined,
      };
    });
  },
  openModal: (baseId: string, workflowId: string) => {
    set((state) => {
      return {
        ...state,
        baseId,
        workflowId,
      };
    });
  },
  setModal: (props: Pick<IWorkFlowPanelState, 'baseId' | 'workflowId' | 'buttonFieldId'>) => {
    set((state) => {
      return {
        ...state,
        ...props,
      };
    });
  },
}));
