import { create } from 'zustand';

interface ITemplateCreateBaseState {
  templateId?: string;
  closeModal: () => void;
  openModal: (templateId: string) => void;
}

export const useTemplateCreateBaseStore = create<ITemplateCreateBaseState>((set) => ({
  closeModal: () => {
    set((state) => {
      return {
        ...state,
        templateId: undefined,
      };
    });
  },
  openModal: (templateId: string) => {
    set((state) => {
      return {
        ...state,
        templateId,
      };
    });
  },
}));
