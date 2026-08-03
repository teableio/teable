import { create } from 'zustand';

interface ITemplateCreateBaseState {
  templateId?: string;
  spaceId?: string;
  closeModal: () => void;
  openModal: (templateId: string, spaceId?: string) => void;
}

export const useTemplateCreateBaseStore = create<ITemplateCreateBaseState>((set) => ({
  closeModal: () => {
    set((state) => {
      return {
        ...state,
        templateId: undefined,
        spaceId: undefined,
      };
    });
  },
  openModal: (templateId: string, spaceId?: string) => {
    set((state) => {
      return {
        ...state,
        templateId,
        spaceId,
      };
    });
  },
}));
