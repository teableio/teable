import { z } from 'zod';
import { create } from 'zustand';

const from = ['buttonFieldOptions'] as const;
const fromSchema = z.enum(from);
type From = z.infer<typeof fromSchema>;

interface IWorkFlowPanelState {
  baseId?: string;
  workflowId?: string;
  open?: boolean;
  from?: From;
  closeModal: () => void;
  openModal: (baseId: string, workflowId: string) => void;
  setModal: (props: Pick<IWorkFlowPanelState, 'baseId' | 'workflowId' | 'open' | 'from'>) => void;
}

export const useWorkFlowPanelStore = create<IWorkFlowPanelState>((set) => ({
  closeModal: () => {
    set((state) => {
      return {
        ...state,
        baseId: undefined,
        workflowId: undefined,
        open: false,
        from: undefined,
      };
    });
  },
  openModal: (baseId: string, workflowId: string) => {
    set((state) => {
      return {
        ...state,
        baseId,
        workflowId,
        open: true,
      };
    });
  },
  setModal: (props: Pick<IWorkFlowPanelState, 'baseId' | 'workflowId' | 'open' | 'from'>) => {
    set((state) => {
      return {
        ...state,
        ...props,
      };
    });
  },
}));
