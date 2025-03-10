import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LocalStorageKeys } from '../config';

export enum InteractionMode {
  Mouse = 'mouse',
  Touch = 'touch',
  System = 'system',
}

interface IInteractionModeState {
  interactionMode: InteractionMode;
  updateInteractionMode: (type: InteractionMode) => void;
}

export const useInteractionModeStore = create<IInteractionModeState>()(
  persist(
    (set) => ({
      interactionMode: InteractionMode.System,
      updateInteractionMode: (type: InteractionMode) => set({ interactionMode: type }),
    }),
    {
      name: LocalStorageKeys.InteractionMode,
    }
  )
);
