import { createContext, useContext } from 'react';

export interface IPresentationModeContext {
  isPresenting: boolean;
  setPresenting: (value: boolean) => void;
}

export const PresentationModeContext = createContext<IPresentationModeContext | null>(null);

export const usePresentationMode = () => {
  const context = useContext(PresentationModeContext);
  if (!context) {
    throw new Error('usePresentationMode must be used within PresentationModeProvider');
  }
  return context;
};
